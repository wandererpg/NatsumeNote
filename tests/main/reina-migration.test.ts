import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION, migrate } from '../../src/main/database/migrations';

it('upgrades version 8 without changing music/journal data and cascades only external projections', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    migrate(db);
    // Restore the exact pre-bridge schema in this synthetic database.
    db.exec('DROP TABLE game_tag_index; DROP TABLE external_game_links; DROP TABLE external_play_sources; DELETE FROM schema_migrations WHERE version=9; PRAGMA user_version=8;');
    db.prepare('INSERT INTO games(id,name) VALUES (?,?)').run('g', 'Existing game');
    db.prepare('INSERT INTO tracks(id,game_id,file_path,file_name,format,file_size,file_hash) VALUES (?,?,?,?,?,?,?)').run('t','g','C:/synthetic/a.ogg','a.ogg','ogg',100,'synthetic-hash');
    db.prepare('INSERT INTO journal_pages(id,game_id,title,blocks_json,tags_json) VALUES (?,?,?,?,?)').run('p','g','Existing journal','[]','["日记"]');
    const before = ['games','tracks','journal_pages'].map(table => db.prepare(`SELECT * FROM ${table}`).all());
    migrate(db);
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    expect(['games','tracks','journal_pages'].map(table => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    db.prepare('INSERT INTO external_play_sources VALUES (?,?,?,?,?)').run('s','Synthetic','C:/synthetic/source.db','identity','2026-10-21T00:00:00Z');
    db.prepare('INSERT INTO external_game_links(local_game_id,source_id,external_game_id,external_name,external_ids_json) VALUES (?,?,?,?,?)').run('g','s',42,'External','[]');
    db.prepare('INSERT INTO game_tag_index VALUES (?,?,?,?,?)').run('g','reina:s','s','custom','剧情');
    db.prepare('INSERT INTO game_tag_index VALUES (?,?,?,?,?)').run('g','metadata:vndb',null,'vndb','校园');
    db.prepare('DELETE FROM external_play_sources WHERE id=?').run('s');
    expect(db.prepare('SELECT * FROM external_game_links').all()).toEqual([]);
    expect(db.prepare('SELECT name FROM game_tag_index').all()).toEqual([{ name: '校园' }]);
    expect(['games','tracks','journal_pages'].map(table => db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    migrate(db);
    expect(db.prepare('SELECT name FROM game_tag_index').all()).toEqual([{ name: '校园' }]);
  } finally { db.close(); }
});
