import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '../../src/main/database/migrations';
import { createGame } from '../../src/main/database/queries/games';
import { getGameSource, upsertGameSource } from '../../src/main/database/queries/game-sources';
import { createGameMetadataService, type MetadataHttpClient } from '../../src/main/services/game-metadata';

describe('metadata for Reina imports', () => {
  const databases: Database.Database[] = [];
  afterEach(() => { for (const db of databases.splice(0)) db.close(); });
  function setup(ids = [{ provider: 'vndb', id: 'v17' }, { provider: 'bangumi', id: '100' }]) {
    const db = new Database(':memory:'); databases.push(db); migrate(db);
    createGame(db, { id: 'game', name: '导入时自定义的文件夹名称 (2)' });
    db.prepare('INSERT INTO external_play_sources VALUES (?,?,?,?,?)').run('source', 'Reina', 'D:/synthetic.db', 'identity', '2026-10-21');
    db.prepare('INSERT INTO external_game_links VALUES (?,?,?,?,?,0)').run('game', 'source', 1, 'Original title', JSON.stringify(ids));
    const fetch = vi.fn<MetadataHttpClient['fetch']>().mockImplementation(async (url, init) => {
      const id = url.includes('/kana/vn') ? JSON.parse(init!.body!).filters[2] : url.split('/').pop();
      const item = { id, title: 'Original title', name: 'Original title', type: 4, description: 'Imported description', summary: 'Imported description' };
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => url.includes('/kana/vn') ? { results: [item] } : item, arrayBuffer: async () => new ArrayBuffer(0) };
    });
    const service = createGameMetadataService({ db, getLibraryPath: () => 'D:/synthetic-library', http: { fetch },
      loadCredits: async () => ({ characters: [], staff: [] }) });
    const ensure = () => service.ensure('game', { signal: new AbortController().signal });
    return { db, fetch, service, ensure };
  }
  function cache(db: Database.Database, status: 'ambiguous' | 'no_match' | 'failed', externalId: string | null = null) {
    upsertGameSource(db, { gameId: 'game', source: 'vndb', externalId, queryName: 'Old title', status, dataJson: null,
      imageUrl: null, fetchedAt: '2026-10-21', retryAfter: '2099-01-01T00:00:00Z', errorMessage: null });
  }

  it('uses confirmed imported IDs instead of searching the folder name and caches the result', async () => {
    const { ensure, fetch } = setup();
    const result = await ensure();
    expect(result.sources.map(row => [row.source, row.status, row.externalId])).toEqual([
      ['vndb', 'matched', 'v17'], ['bangumi', 'matched', '100'],
    ]);
    expect(JSON.parse(fetch.mock.calls.find(([url]) => url.includes('/kana/vn'))![1]!.body!).filters).toEqual(['id', '=', 'v17']);
    expect(JSON.parse(fetch.mock.calls.find(([url]) => url.includes('/kana/vn'))![1]!.body!).fields.split(','))
      .toEqual(expect.arrayContaining(['languages', 'platforms', 'tags.name', 'tags.rating', 'tags.spoiler']));
    expect(fetch.mock.calls.some(([url]) => url.includes('/search/'))).toBe(false);
    await ensure();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['ambiguous', 'no_match', 'failed'] as const)('recovers old %s title-search caches from confirmed IDs', async status => {
    const { db, ensure } = setup(); cache(db, status);
    expect((await ensure()).sources[0]).toMatchObject({ status: 'matched', externalId: 'v17' });
  });

  it('retains the imported ID on failure, respects backoff, and retries by ID on refresh', async () => {
    const { db, ensure, service, fetch } = setup();
    fetch.mockRejectedValue(new Error('Network unavailable'));
    await ensure();
    expect(getGameSource(db, 'game', 'vndb')).toMatchObject({ status: 'failed', externalId: 'v17' });
    await ensure(); expect(fetch).toHaveBeenCalledTimes(2);
    await service.refresh('game'); expect(fetch).toHaveBeenCalledTimes(4);
    expect(JSON.parse(fetch.mock.calls[2][1]!.body!).filters).toEqual(['id', '=', 'v17']);
  });

  it('preserves an existing manually confirmed match during forced refresh', async () => {
    const { db, service } = setup();
    cache(db, 'failed', 'v2');
    db.prepare("UPDATE game_sources SET status='matched',match_method='manual',confirmed_at='2026-10-21' WHERE source='vndb'").run();
    expect((await service.refresh('game')).sources[0]).toMatchObject({ status: 'matched', externalId: 'v2', matchMethod: 'manual' });
  });

  it.each(['stale', 'conflict', 'invalid'] as const)('does not auto-confirm %s link IDs', async mode => {
    const { db, ensure, fetch } = setup();
    if (mode === 'stale') db.prepare('UPDATE external_game_links SET needs_confirmation=1').run();
    if (mode === 'invalid') db.prepare("UPDATE external_game_links SET external_ids_json='invalid JSON'").run();
    if (mode === 'conflict') {
      db.prepare('INSERT INTO external_play_sources VALUES (?,?,?,?,?)').run('other', 'Other', 'D:/other.db', 'identity', '2026-10-21');
      db.prepare('INSERT INTO external_game_links VALUES (?,?,?,?,?,0)').run('game', 'other', 2, 'Other', JSON.stringify([{ provider: 'vndb', id: 'v2' }]));
    }
    await ensure();
    const filters = JSON.parse(fetch.mock.calls.find(([url]) => url.includes('/kana/vn'))![1]!.body!).filters;
    expect(filters[0]).toBe('search');
  });

  it('discards an ID lookup if its source link is removed while loading', async () => {
    const { db, ensure, fetch } = setup();
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url, init) => {
      const response = await original(url, init);
      db.prepare('DELETE FROM external_game_links').run();
      return response;
    });
    const result = await ensure();
    expect(result.sources.every(row => row.status === 'pending')).toBe(true);
  });
});
