import type Database from 'better-sqlite3';
import type { ReinaTag } from '../../shared/reina';
import { listGames } from '../database/queries/games';
export function syncMetadataTags(db: Database.Database): void {
  const rows = db.prepare("SELECT game_id,source,data_json FROM game_sources WHERE status='matched'").all() as { game_id: string; source: 'vndb' | 'bangumi'; data_json: string | null }[];
  db.transaction(() => {
    db.prepare("DELETE FROM game_tag_index WHERE origin_key LIKE 'metadata:%'").run();
    const insert = db.prepare('INSERT OR IGNORE INTO game_tag_index(local_game_id,origin_key,provider,name) VALUES (?,?,?,?)');
    for (const row of rows) {
      try {
        const data: unknown = JSON.parse(row.data_json ?? '{}');
        const matched = (data as { matched?: { tags?: unknown } })?.matched;
        if (!Array.isArray(matched?.tags)) continue;
        for (const tag of matched.tags) if (typeof tag === 'string' && tag.trim() && tag.length <= 200) insert.run(row.game_id, `metadata:${row.source}`, row.source, tag.trim());
      } catch { /* Malformed optional metadata must not break the local library. */ }
    }
  })();
}
export function replaceExternalTags(db: Database.Database, gameId: string, sourceId: string, tags: ReinaTag[]): void {
  db.transaction(() => {
    db.prepare('DELETE FROM game_tag_index WHERE local_game_id=? AND origin_key=?').run(gameId, `reina:${sourceId}`);
    const insert = db.prepare('INSERT OR IGNORE INTO game_tag_index(local_game_id,origin_key,source_id,provider,name) VALUES (?,?,?,?,?)');
    for (const tag of tags) if (tag.name.trim() && tag.name.length <= 200 && ['vndb', 'bangumi', 'custom'].includes(tag.provider)) insert.run(gameId, `reina:${sourceId}`, sourceId, tag.provider, tag.name.trim());
  })();
}
export function listIndexedTags(db: Database.Database, gameId?: string): ReinaTag[] {
  syncMetadataTags(db);
  return db.prepare(`SELECT DISTINCT name,provider FROM game_tag_index ${gameId === undefined ? '' : 'WHERE local_game_id=?'} ORDER BY name,provider`).all(...(gameId === undefined ? [] : [gameId])) as ReinaTag[];
}
export function filterIndexedGames(db: Database.Database, tags: string[]) {
  syncMetadataTags(db);
  if (!tags.length) return listGames(db);
  const unique = [...new Set(tags)];
  const ids = new Set((db.prepare(`SELECT local_game_id FROM game_tag_index WHERE (provider || ':' || name) IN (${unique.map(() => '?').join(',')}) GROUP BY local_game_id HAVING COUNT(DISTINCT provider || ':' || name)=?`).all(...unique, unique.length) as { local_game_id: string }[]).map(row => row.local_game_id));
  return listGames(db).filter(game => ids.has(game.id));
}
