import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '../../shared/errors';
import { assertWithin, sanitizeDirectoryName } from '../../shared/paths';
import type { JournalAsset, JournalAssetKind } from '../../shared/types';
import type { SQLiteDatabase } from '../database/connection';
import { getGame } from '../database/queries/games';
import {
  findJournalAssetByHash,
  insertJournalAsset,
  listJournalAssets,
} from '../database/queries/journal';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogv', '.mov']);

export function journalMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.ogv': return 'video/ogg';
    case '.mov': return 'video/quicktime';
    default: return 'application/octet-stream';
  }
}

export function isJournalMediaFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(extension) || VIDEO_EXTENSIONS.has(extension);
}

function assertKind(filePath: string, kind: JournalAssetKind): string {
  const extension = path.extname(filePath).toLowerCase();
  const allowed = kind === 'image' ? IMAGE_EXTENSIONS : VIDEO_EXTENSIONS;
  if (!allowed.has(extension)) {
    const message = kind === 'image'
      ? '请选择 PNG、JPG、WEBP 或 GIF 图片。'
      : '请选择 MP4、WEBM、OGV 或 MOV 视频。';
    throw new AppError('UNSUPPORTED_FORMAT', `Unsupported journal ${kind}: ${extension || 'unknown'}`, message);
  }
  return extension;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export interface JournalAssetService {
  list(gameId: string): JournalAsset[];
  importFiles(gameId: string, kind: JournalAssetKind, filePaths: string[]): Promise<JournalAsset[]>;
}

export interface JournalAssetServiceOptions {
  db: SQLiteDatabase;
  getLibraryPath(): string | Promise<string>;
  idFactory?: () => string;
}

export function createJournalAssetService(options: JournalAssetServiceOptions): JournalAssetService {
  const idFactory = options.idFactory ?? randomUUID;

  return {
    list: (gameId) => listJournalAssets(options.db, gameId),
    async importFiles(gameId, kind, filePaths) {
      const game = getGame(options.db, gameId);
      if (!game) throw new AppError('FILE_NOT_FOUND', `Game not found: ${gameId}`, '找不到指定的作品。');
      if (filePaths.length === 0) return [];
      const libraryValue = await options.getLibraryPath();
      if (!libraryValue.trim()) throw new AppError('DB_ERROR', 'Library path is not configured', '请先设置音乐库目录。');
      const libraryPath = path.resolve(libraryValue);
      const targetDirectory = assertWithin(
        path.join(libraryPath, sanitizeDirectoryName(game.name), '手账', '素材'),
        libraryPath,
      );
      const imported: JournalAsset[] = [];

      for (const sourcePath of filePaths) {
        if (!path.isAbsolute(sourcePath)) throw new AppError('FILE_NOT_FOUND', `Journal source path is not absolute: ${sourcePath}`, '找不到所选素材。');
        const extension = assertKind(sourcePath, kind);
        const sourceStat = await stat(sourcePath).catch(() => null);
        if (!sourceStat?.isFile()) throw new AppError('FILE_NOT_FOUND', `Journal source is unavailable: ${sourcePath}`, '找不到所选素材。');
        const fileHash = await sha256File(sourcePath);
        const existing = findJournalAssetByHash(options.db, gameId, fileHash);
        if (existing) {
          imported.push(existing);
          continue;
        }

        const id = idFactory();
        await mkdir(targetDirectory, { recursive: true });
        const targetPath = assertWithin(path.join(targetDirectory, `${id}${extension}`), libraryPath);
        try {
          await copyFile(sourcePath, targetPath);
          imported.push(insertJournalAsset(options.db, {
            id,
            gameId,
            kind,
            filePath: targetPath,
            fileName: path.basename(sourcePath),
            mimeType: journalMimeType(sourcePath),
            fileSize: sourceStat.size,
            fileHash,
          }));
        } catch (error) {
          await rm(targetPath, { force: true }).catch(() => undefined);
          throw error;
        }
      }
      return imported;
    },
  };
}
