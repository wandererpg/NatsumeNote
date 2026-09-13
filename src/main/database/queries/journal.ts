import type Database from 'better-sqlite3';

import type {
  JournalAsset,
  JournalAssetCreate,
  JournalBlock,
  JournalPage,
  JournalPageBackground,
  JournalPageCreate,
  JournalPageDraft,
} from '../../../shared/types';

type SQLiteDatabase = Database.Database;

interface JournalPageRow {
  id: string;
  gameId: string;
  title: string;
  position: number;
  canvasWidth: number;
  canvasHeight: number;
  backgroundJson: string;
  blocksJson: string;
  tagsJson: string;
  soundtrackTrackId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

interface JournalAssetRow {
  id: string;
  gameId: string;
  kind: JournalAsset['kind'];
  filePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileHash: string;
  createdAt: string;
}

const DEFAULT_BACKGROUND: JournalPageBackground = { color: '#fffaf0', pattern: 'paper' };

const PAGE_SELECT = `
  SELECT
    id,
    game_id AS gameId,
    title,
    position,
    canvas_width AS canvasWidth,
    canvas_height AS canvasHeight,
    background_json AS backgroundJson,
    blocks_json AS blocksJson,
    tags_json AS tagsJson,
    soundtrack_track_id AS soundtrackTrackId,
    revision,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM journal_pages
`;

const ASSET_SELECT = `
  SELECT
    id,
    game_id AS gameId,
    kind,
    file_path AS filePath,
    file_name AS fileName,
    mime_type AS mimeType,
    file_size AS fileSize,
    file_hash AS fileHash,
    created_at AS createdAt
  FROM journal_assets
`;

function parseArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function parseBackground(value: string): JournalPageBackground {
  try {
    const parsed = JSON.parse(value) as Partial<JournalPageBackground>;
    const color = typeof parsed.color === 'string' && parsed.color.trim() ? parsed.color : DEFAULT_BACKGROUND.color;
    const pattern = parsed.pattern === 'plain' || parsed.pattern === 'grid' || parsed.pattern === 'dots' || parsed.pattern === 'paper'
      ? parsed.pattern
      : DEFAULT_BACKGROUND.pattern;
    return { color, pattern };
  } catch {
    return { ...DEFAULT_BACKGROUND };
  }
}

function mapPage(row: JournalPageRow | undefined): JournalPage | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    gameId: row.gameId,
    title: row.title,
    position: row.position,
    canvasWidth: row.canvasWidth,
    canvasHeight: row.canvasHeight,
    background: parseBackground(row.backgroundJson),
    blocks: parseArray<JournalBlock>(row.blocksJson),
    tags: parseArray<unknown>(row.tagsJson).filter((tag): tag is string => typeof tag === 'string'),
    soundtrackTrackId: row.soundtrackTrackId,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createJournalPage(db: SQLiteDatabase, input: JournalPageCreate): JournalPage {
  const nextPosition = db.prepare(`
    SELECT COALESCE(MAX(position), -1) + 1 AS position
    FROM journal_pages
    WHERE game_id = ?
  `).get(input.gameId) as { position: number };
  db.prepare(`
    INSERT INTO journal_pages (
      id, game_id, title, position, canvas_width, canvas_height,
      background_json, blocks_json, tags_json, soundtrack_track_id
    ) VALUES (
      @id, @gameId, @title, @position, @canvasWidth, @canvasHeight,
      @backgroundJson, @blocksJson, @tagsJson, @soundtrackTrackId
    )
  `).run({
    id: input.id,
    gameId: input.gameId,
    title: input.title,
    position: nextPosition.position,
    canvasWidth: input.canvasWidth,
    canvasHeight: input.canvasHeight,
    backgroundJson: JSON.stringify(input.background ?? DEFAULT_BACKGROUND),
    blocksJson: JSON.stringify(input.blocks ?? []),
    tagsJson: JSON.stringify(input.tags ?? []),
    soundtrackTrackId: input.soundtrackTrackId ?? null,
  });
  return getJournalPage(db, input.id)!;
}

export function getJournalPage(db: SQLiteDatabase, pageId: string): JournalPage | undefined {
  return mapPage(db.prepare(`${PAGE_SELECT} WHERE id = ?`).get(pageId) as JournalPageRow | undefined);
}

export function listJournalPages(db: SQLiteDatabase, gameId: string): JournalPage[] {
  const rows = db.prepare(`${PAGE_SELECT} WHERE game_id = ? ORDER BY position ASC, created_at ASC, id ASC`).all(gameId) as JournalPageRow[];
  return rows.map((row) => mapPage(row)!);
}

/** Save one page only if the renderer still owns the latest revision. */
export function saveJournalPage(db: SQLiteDatabase, draft: JournalPageDraft): JournalPage {
  const result = db.prepare(`
    UPDATE journal_pages
    SET title = @title,
        position = @position,
        canvas_width = @canvasWidth,
        canvas_height = @canvasHeight,
        background_json = @backgroundJson,
        blocks_json = @blocksJson,
        tags_json = @tagsJson,
        soundtrack_track_id = @soundtrackTrackId,
        revision = revision + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = @id AND game_id = @gameId AND revision = @revision
  `).run({
    ...draft,
    backgroundJson: JSON.stringify(draft.background),
    blocksJson: JSON.stringify(draft.blocks),
    tagsJson: JSON.stringify(draft.tags),
  });
  if (result.changes === 0) {
    throw new Error(`Journal page revision conflict: ${draft.id}`);
  }
  return getJournalPage(db, draft.id)!;
}

export function deleteJournalPage(db: SQLiteDatabase, pageId: string): boolean {
  return db.prepare('DELETE FROM journal_pages WHERE id = ?').run(pageId).changes > 0;
}

export function insertJournalAsset(db: SQLiteDatabase, input: JournalAssetCreate): JournalAsset {
  db.prepare(`
    INSERT INTO journal_assets (
      id, game_id, kind, file_path, file_name, mime_type, file_size, file_hash
    ) VALUES (
      @id, @gameId, @kind, @filePath, @fileName, @mimeType, @fileSize, @fileHash
    )
  `).run(input);
  return getJournalAsset(db, input.id)!;
}

export function getJournalAsset(db: SQLiteDatabase, assetId: string): JournalAsset | undefined {
  return db.prepare(`${ASSET_SELECT} WHERE id = ?`).get(assetId) as JournalAssetRow | undefined;
}

export function findJournalAssetByHash(db: SQLiteDatabase, gameId: string, fileHash: string): JournalAsset | undefined {
  return db.prepare(`${ASSET_SELECT} WHERE game_id = ? AND file_hash = ?`).get(gameId, fileHash) as JournalAssetRow | undefined;
}

export function listJournalAssets(db: SQLiteDatabase, gameId: string): JournalAsset[] {
  return db.prepare(`${ASSET_SELECT} WHERE game_id = ? ORDER BY created_at ASC, id ASC`).all(gameId) as JournalAssetRow[];
}

export function updateJournalAssetPaths(db: SQLiteDatabase, oldRoot: string, nextRoot: string): void {
  const rows = db.prepare(`${ASSET_SELECT}`).all() as JournalAssetRow[];
  const update = db.prepare('UPDATE journal_assets SET file_path = ? WHERE id = ?');
  for (const row of rows) {
    if (row.filePath === oldRoot || row.filePath.startsWith(`${oldRoot}\\`) || row.filePath.startsWith(`${oldRoot}/`)) {
      update.run(nextRoot + row.filePath.slice(oldRoot.length), row.id);
    }
  }
}
