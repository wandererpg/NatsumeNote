import Database from 'better-sqlite3';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { migrate } from '../../src/main/database/migrations';
import { createGame } from '../../src/main/database/queries/games';
import { createJournalAssetService } from '../../src/main/services/journal-assets';

describe('journal asset service', () => {
  it('copies selected media into the game scrapbook and deduplicates by hash', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'natsume-journal-assets-'));
    const library = path.join(root, 'library');
    const source = path.join(root, 'memory.png');
    const db = new Database(':memory:');
    migrate(db);
    createGame(db, { id: 'g1', name: 'Summer Pockets' });
    await writeFile(source, 'image-bytes');

    try {
      const service = createJournalAssetService({
        db,
        getLibraryPath: () => library,
        idFactory: () => 'asset-1',
      });
      const [first] = await service.importFiles('g1', 'image', [source]);
      const [duplicate] = await service.importFiles('g1', 'image', [source]);

      expect(first).toMatchObject({
        id: 'asset-1', gameId: 'g1', kind: 'image', fileName: 'memory.png', mimeType: 'image/png', fileSize: 11,
      });
      expect(first.filePath).toBe(path.join(library, 'Summer Pockets', '手账', '素材', 'asset-1.png'));
      expect(await readFile(first.filePath, 'utf8')).toBe('image-bytes');
      expect(duplicate.id).toBe(first.id);
      expect(service.list('g1')).toHaveLength(1);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unsupported or mismatched file kinds without creating a managed copy', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'natsume-journal-reject-'));
    const library = path.join(root, 'library');
    const executable = path.join(root, 'payload.exe');
    const video = path.join(root, 'scene.mp4');
    const db = new Database(':memory:');
    migrate(db);
    createGame(db, { id: 'g1', name: 'ATRI' });
    await writeFile(executable, 'not-media');
    await writeFile(video, 'video');

    try {
      const service = createJournalAssetService({ db, getLibraryPath: () => library });
      await expect(service.importFiles('g1', 'image', [executable])).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
      await expect(service.importFiles('g1', 'image', [video])).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
      await expect(access(path.join(library, 'ATRI', '手账'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
