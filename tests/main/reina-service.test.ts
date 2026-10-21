import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate } from '../../src/main/database/migrations';
import { ReinaService } from '../../src/main/reina/service';
import type { ReinaEnvelope, ReinaGame, ReinaQuery, ReinaTool } from '../../src/shared/reina';
const game: ReinaGame = { id: 42, name: '同名作品', externalIds: [{ provider: 'vndb', id: 'v42' }], tags: [{ name: '剧情', provider: 'vndb' }], unsupportedTagProviders: [] };
describe('Reina authorization and explicit links', () => {
  let db: Database.Database; let dir: string; let service: ReinaService;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'reina-service-'));
    db = new Database(path.join(dir, 'galmusic.db')); migrate(db);
    db.prepare('INSERT INTO games(id,name) VALUES (?,?)').run('local', '同名作品');
    db.prepare('INSERT INTO games(id,name) VALUES (?,?)').run('other', '同名作品');
    service = new ReinaService(db, {
      async call(_path: string, _identity: string, tool: ReinaTool, query: ReinaQuery): Promise<ReinaEnvelope> {
        return { contractVersion: 1, sourceApp: 'ReinaManager', sourceId: query.sourceId, snapshotId: 'snap', fetchedAt: new Date().toISOString(), warnings: [], data: tool === 'reina_list_games' ? [game] : tool === 'reina_get_tags' ? game.tags : { readable: true, liveSession: false, schemaProfile: 'test' }, nextCursor: null };
      }, invalidate() {}, close() {},
    });
  });
  afterEach(async () => { await service.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  it('requires native-authorized connection, does not auto-bind names and keeps paths private', async () => {
    await expect(service.query('reina_list_games', { sourceId: 'arbitrary' })).rejects.toThrow();
    const sourcePath = path.join(dir, 'reina_manager.db'); writeFileSync(sourcePath, 'synthetic');
    const source = await service.connectSelectedFile(sourcePath);
    expect(JSON.stringify(service.sources())).not.toContain(dir);
    expect(service.links('local')).toEqual([]);
    await expect(service.bind({ localGameId: 'local', sourceId: source.id, externalGameId: 42, externalName: game.name })).rejects.toThrow('预览');
    await service.query('reina_list_games', { sourceId: source.id });
    await service.bind({ localGameId: 'local', sourceId: source.id, externalGameId: 42, externalName: 'untrusted name' });
    expect(service.links('local')[0].externalName).toBe('同名作品');
    await expect(service.bind({ localGameId: 'other', sourceId: source.id, externalGameId: 42, externalName: game.name })).rejects.toThrow();
    expect(service.tags('local')).toEqual(game.tags);
    service.unbind('local', source.id);
    expect(service.tags('local')).toEqual([]);
  });
  it('rejects the application database and invalidates disconnected sources', async () => {
    await expect(service.connectSelectedFile(db.name)).rejects.toThrow();
    const file = path.join(dir, 'source.db'); writeFileSync(file, 'synthetic');
    const source = await service.connectSelectedFile(file);
    service.disconnect(source.id);
    await expect(service.query('reina_get_connection', { sourceId: source.id })).rejects.toThrow();
  });
  it('preserves confirmed links after restart and rejects a replaced source file', async () => {
    const file = path.join(dir, 'source.db'); writeFileSync(file, 'synthetic');
    const source = await service.connectSelectedFile(file);
    await service.query('reina_list_games', { sourceId: source.id });
    await service.bind({ localGameId: 'local', sourceId: source.id, externalGameId: 42, externalName: game.name });
    await service.close();
    service = new ReinaService(db, {
      async call(_path, _identity, _tool, query) {
        return { contractVersion: 1, sourceApp: 'ReinaManager', sourceId: query.sourceId, snapshotId: 'restart', fetchedAt: new Date().toISOString(), warnings: [], data: { readable: true }, nextCursor: null };
      }, invalidate() {}, close() {},
    });
    expect(service.sources()[0].id).toBe(source.id);
    expect(service.links('local')[0].externalGameId).toBe(42);
    expect(service.tags('local')).toEqual(game.tags);
    await expect(service.query('reina_get_connection', { sourceId: source.id })).resolves.toMatchObject({ snapshotId: 'restart' });
    renameSync(file, file + '.old'); writeFileSync(file, 'replacement');
    await expect(service.query('reina_get_connection', { sourceId: source.id })).rejects.toThrow();
    expect(service.links('local')).toHaveLength(1);
    const reauthorized = await service.connectSelectedFile(file);
    expect(reauthorized.id).toBe(source.id);
    expect(service.links('local')[0]).toMatchObject({ externalGameId:42, needsConfirmation:true });
    expect(service.tags('local')).toEqual([]);
    await expect(service.query('reina_get_stats',{sourceId:source.id,gameId:42})).rejects.toMatchObject({code:'LINK_CHANGED'});
    service.disconnect(source.id);
    expect(service.links('local')).toEqual([]);
    expect(service.tags('local')).toEqual([]);
  });
  it('returns successful stats with a warning when tags cannot refresh', async () => {
    const file = path.join(dir,'source.db'); writeFileSync(file,'synthetic');
    const source = await service.connectSelectedFile(file);
    await service.query('reina_list_games',{sourceId:source.id});
    await service.bind({localGameId:'local',sourceId:source.id,externalGameId:42,externalName:game.name});
    await service.close();
    service = new ReinaService(db, {
      async call(_path,_identity,tool,query) {
        if (tool==='reina_get_tags') throw new Error('synthetic busy');
        return { contractVersion:1,sourceApp:'ReinaManager',sourceId:query.sourceId,snapshotId:'good-stats',fetchedAt:new Date().toISOString(),warnings:[],data:{sessionTotalMinutes:12},nextCursor:null };
      }, invalidate(){},close(){},
    });
    const result = await service.query('reina_get_stats',{sourceId:source.id,gameId:42});
    expect(result.data).toMatchObject({sessionTotalMinutes:12});
    expect(result.warnings.join(' ')).toContain('标签刷新失败');
    expect(service.tags('local')).toEqual(game.tags);
  });
  it('requires another confirmation when provider IDs change after candidate preview', async () => {
    const file = path.join(dir, 'source.db'); writeFileSync(file, 'synthetic');
    const source = await service.connectSelectedFile(file);
    await service.query('reina_list_games', { sourceId: source.id });
    const original = game.externalIds;
    try {
      game.externalIds = [{ provider: 'vndb', id: 'v999' }];
      await expect(service.bind({ localGameId: 'local', sourceId: source.id, externalGameId: 42, externalName: game.name })).rejects.toThrow('已改变');
      expect(service.links('local')).toEqual([]);
    } finally { game.externalIds = original; }
  });
  it('aggregates all matched metadata providers and applies AND filters across the whole library', () => {
    const insert = db.prepare("INSERT INTO game_sources(game_id,source,query_name,status,data_json) VALUES (?,?,?,'matched',?)");
    insert.run('local','vndb','同名作品',JSON.stringify({matched:{tags:['剧情','校园']}}));
    insert.run('local','bangumi','同名作品',JSON.stringify({matched:{tags:['恋爱']}}));
    insert.run('other','bangumi','同名作品',JSON.stringify({matched:{tags:['剧情']}}));
    expect(service.tags('local').map(t=>t.name)).toEqual(expect.arrayContaining(['剧情','校园','恋爱']));
    expect(service.filterGames(['vndb:剧情','bangumi:恋爱']).map(g=>g.id)).toEqual(['local']);
    expect(service.filterGames(['vndb:剧情']).map(g=>g.id)).toEqual(['local']);
    expect(service.filterGames(['bangumi:剧情']).map(g=>g.id)).toEqual(['other']);
    expect(service.filterGames(['bangumi:剧情','vndb:剧情'])).toEqual([]);
    expect(service.filterGames([])).toHaveLength(2);
  });
});
