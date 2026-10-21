import type Database from 'better-sqlite3';
import type { MetadataSource } from '../../shared/types';

/** Only unambiguous IDs from user-confirmed links may bypass title matching. */
export function confirmedReinaMetadataIds(db: Database.Database, gameId: string): Partial<Record<MetadataSource, string>> {
  const values = new Map<MetadataSource, Set<string>>();
  const rows = db.prepare('SELECT external_ids_json FROM external_game_links WHERE local_game_id=? AND needs_confirmation=0')
    .all(gameId) as { external_ids_json: string }[];
  for (const row of rows) {
    let entries: unknown;
    try { entries = JSON.parse(row.external_ids_json); } catch { continue; }
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
      const provider = entry.provider as MetadataSource;
      if (provider !== 'vndb' && provider !== 'bangumi') continue;
      const id = entry.id.trim();
      if (id.length > 24 || !(provider === 'vndb' ? /^v[1-9]\d*$/ : /^[1-9]\d*$/).test(id)) continue;
      const ids = values.get(provider) ?? new Set<string>();
      ids.add(id); values.set(provider, ids);
    }
  }
  const result: Partial<Record<MetadataSource, string>> = {};
  for (const [provider, ids] of values) if (ids.size === 1) result[provider] = [...ids][0];
  return result;
}
