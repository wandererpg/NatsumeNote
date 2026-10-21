import { afterEach, beforeEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate } from '../../src/main/database/migrations';
import { ReinaBatchImport } from '../../src/main/reina/batch-import';
import { ReinaService } from '../../src/main/reina/service';
import { indexLibraryDirectory } from '../../src/main/services/library-directory';
import type { ReinaGame } from '../../src/shared/reina';

let db: Database.Database;
let dir: string;
let root: string;
let service: ReinaService;
let importer: ReinaBatchImport;
let sourceId: string;
let games: ReinaGame[];
const sourceGame = (id: number, name: string): ReinaGame => ({ id, name, externalIds: [], tags: [], unsupportedTagProviders: [] });
beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'reina-batch-'));
  root = path.join(dir, 'library'); mkdirSync(root);
  db = new Database(path.join(dir, 'note.db')); migrate(db);
  games = [sourceGame(1, '已有作品'), sourceGame(2, '新作品')];
  service = new ReinaService(db, {
    async call(_path, _identity, tool, query) {
      const offset = Number(query.cursor ?? 0);
      return { contractVersion: 1, sourceApp: 'ReinaManager', sourceId: query.sourceId, snapshotId: 'snap', fetchedAt: new Date().toISOString(), warnings: [],
        data: tool === 'reina_list_games' ? games.slice(offset, offset + 1) : { readable: true, schemaProfile: 'test', liveSession: false },
        nextCursor: tool === 'reina_list_games' && offset + 1 < games.length ? String(offset + 1) : null };
    }, invalidate() {}, close() {},
  });
  const source = path.join(dir, 'reina.db'); writeFileSync(source, 'source');
  sourceId = (await service.connectSelectedFile(source)).id;
  db.prepare('INSERT INTO games(id,name) VALUES (?,?)').run('local', '已有作品');
  importer = new ReinaBatchImport(db, service, () => root);
});
afterEach(() => { service.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
it('reads every page, links existing games, creates folders and repeats without duplicates', async () => {
  let preview = await importer.preview(sourceId);
  expect(preview.rows.map(row => row.action)).toEqual(['link', 'create']);
  expect(preview.rows[0].localGameId).toBe('local');
  const result = await importer.apply(preview.token, preview.rows);
  expect(result).toMatchObject({ created: 1, linked: 1, skipped: 0 });
  expect(existsSync(path.join(root, '新作品'))).toBe(true);
  expect(db.prepare('SELECT count(*) n FROM external_game_links').get()).toEqual({ n: 2 });
  preview = await importer.preview(sourceId);
  expect(preview.rows.every(row => row.action === 'link')).toBe(true);
  await importer.apply(preview.token, preview.rows);
  expect(db.prepare('SELECT count(*) n FROM games').get()).toEqual({ n: 2 });
});
it('requires a manual choice for ambiguous names and accepts an explicit target', async () => {
  db.prepare('INSERT INTO games(id,name) VALUES (?,?)').run('other', '已有作品');
  const preview = await importer.preview(sourceId);
  expect(preview.rows[0].action).toBe('review');
  await expect(importer.apply(preview.token, preview.rows)).rejects.toThrow('手动');
  preview.rows[0] = { ...preview.rows[0], action: 'link', localGameId: 'other' };
  await importer.apply(preview.token, preview.rows);
  expect(service.links('other')[0].externalGameId).toBe(1);
});
it('rejects changed local data or changed source games before writing folders', async () => {
  let preview = await importer.preview(sourceId);
  db.prepare("UPDATE games SET name='改名' WHERE id='local'").run();
  await expect(importer.apply(preview.token, preview.rows)).rejects.toThrow('预览');
  preview = await importer.preview(sourceId);
  games[1].name = '来源改名';
  await expect(importer.apply(preview.token, preview.rows)).rejects.toThrow('预览');
  expect(readdirSync(root)).toEqual([]);
});
it('avoids existing folders and sanitized name collisions', async () => {
  games = [sourceGame(1, '新:作品'), sourceGame(2, '新?作品')];
  mkdirSync(path.join(root, '新_作品'));
  writeFileSync(path.join(root, '新_作品', 'keep.txt'), 'keep');
  const preview = await importer.preview(sourceId);
  expect(new Set(preview.rows.map(row => row.newName)).size).toBe(2);
  await importer.apply(preview.token, preview.rows);
  expect(readdirSync(root)).toHaveLength(3);
  expect(existsSync(path.join(root, '新_作品', 'keep.txt'))).toBe(true);
});
it('rolls back new empty directories and all database writes on insertion failure', async () => {
  const preview = await importer.preview(sourceId);
  db.exec("CREATE TRIGGER fail_batch BEFORE INSERT ON external_game_links WHEN NEW.external_game_id=2 BEGIN SELECT RAISE(ABORT,'injected'); END");
  // Trigger DDL changes do not count as row changes; exercise the actual apply transaction.
  await expect(importer.apply(preview.token, preview.rows)).rejects.toThrow();
  expect(readdirSync(root)).toEqual([]);
  expect(db.prepare('SELECT count(*) n FROM games').get()).toEqual({ n: 1 });
  expect(db.prepare('SELECT count(*) n FROM external_game_links').get()).toEqual({ n: 0 });
});
it('matches unique metadata IDs across titles and asks about conflicting metadata', async () => {
  games[0].name = '其他语言名称'; games[0].externalIds = [{ provider: 'vndb', id: 'v42' }];
  db.prepare("INSERT INTO game_sources(game_id,source,external_id,query_name,status) VALUES ('local','vndb','42','旧标题','matched')").run();
  let preview = await importer.preview(sourceId);
  expect(preview.rows[0]).toMatchObject({ action: 'link', localGameId: 'local', reason: '资料编号一致' });
  games[0].name = '已有作品'; games[0].externalIds[0].id = 'v43';
  preview = await importer.preview(sourceId);
  expect(preview.rows[0].action).toBe('review');
  games[0].externalIds = [{ provider: 'vndb', id: 'v42' }, { provider: 'bangumi', id: '200' }];
  db.prepare("INSERT INTO game_sources(game_id,source,external_id,query_name,status) VALUES ('local','bangumi','100','旧标题','matched')").run();
  preview = await importer.preview(sourceId);
  expect(preview.rows[0].action).toBe('review');
});
it('rejects duplicate targets, incomplete selections, and overwriting an existing link', async () => {
  let preview = await importer.preview(sourceId);
  await expect(importer.apply(preview.token, preview.rows.slice(0, 1))).rejects.toThrow('不完整');
  await expect(importer.apply(preview.token, preview.rows.map(row => ({ ...row, action: 'link', localGameId: 'local' })))).rejects.toThrow('重复');
  await importer.apply(preview.token, preview.rows);
  preview = await importer.preview(sourceId);
  preview.rows[0] = { ...preview.rows[0], action: 'create' };
  await expect(importer.apply(preview.token, preview.rows)).rejects.toThrow('覆盖');
});
it('allows skipping games and never creates folders for skipped records', async () => {
  const preview = await importer.preview(sourceId);
  const result = await importer.apply(preview.token, preview.rows.map(row => ({ ...row, action: 'skip' })));
  expect(result).toEqual({ created: 0, linked: 0, skipped: 2 });
  expect(readdirSync(root)).toEqual([]);
});
it('requires explicit confirmation for replaced sources or changed linked identities', async () => {
  let preview = await importer.preview(sourceId);
  await importer.apply(preview.token, preview.rows);
  db.prepare('UPDATE external_game_links SET needs_confirmation=1 WHERE external_game_id=1').run();
  games[1].name = '同一来源编号现在是另一部游戏';
  preview = await importer.preview(sourceId);
  expect(preview.rows.every(row => row.action === 'review')).toBe(true);
  expect(preview.rows.every(row => row.alreadyLinked)).toBe(true);
  await expect(importer.apply(preview.token, preview.rows)).rejects.toThrow('手动');
  const decisions = preview.rows.map(row => ({ ...row, action: row.externalGameId === 1 ? 'link' as const : 'skip' as const }));
  await importer.apply(preview.token, decisions);
  expect(service.links('local')[0].needsConfirmation).toBeUndefined();
  const names = db.prepare('SELECT external_name FROM external_game_links WHERE external_game_id=2').get();
  expect(names).toEqual({ external_name: '新作品' });
});
it('keeps imported identities when a later library scan discovers audio in sanitized folders', async () => {
  games = [sourceGame(1, '新:作品')];
  const preview = await importer.preview(sourceId);
  await importer.apply(preview.token, preview.rows);
  const game = db.prepare("SELECT id,name FROM games WHERE name='新_作品'").get() as { id: string; name: string };
  const bytes = Buffer.alloc(44 + 16000);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  writeFileSync(path.join(root, game.name, 'theme.wav'), bytes);
  await indexLibraryDirectory(db, root);
  expect(db.prepare('SELECT game_id FROM tracks').get()).toEqual({ game_id: game.id });
  expect(service.links(game.id)[0].externalGameId).toBe(1);
  expect(db.prepare('SELECT count(*) n FROM games').get()).toEqual({ n: 2 });
});
