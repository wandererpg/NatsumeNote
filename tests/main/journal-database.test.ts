import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { migrate } from '../../src/main/database/migrations';
import { createGame } from '../../src/main/database/queries/games';
import {
  createJournalPage,
  deleteJournalPage,
  getJournalPage,
  insertJournalAsset,
  listJournalAssets,
  listJournalPages,
  saveJournalPage,
} from '../../src/main/database/queries/journal';

describe('journal database', () => {
  it('migrates paged scene documents and managed assets', () => {
    const db = new Database(':memory:');
    migrate(db);

    expect(db.pragma('user_version', { simple: true })).toBe(6);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'journal_pages'").get())
      .toEqual({ name: 'journal_pages' });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'journal_assets'").get())
      .toEqual({ name: 'journal_assets' });
    db.close();
  });

  it('creates, orders, round-trips and revision-checks journal pages', () => {
    const db = new Database(':memory:');
    migrate(db);
    createGame(db, { id: 'g1', name: 'ATRI' });

    const page = createJournalPage(db, {
      id: 'page-1', gameId: 'g1', title: '序章', canvasWidth: 1440, canvasHeight: 1000,
    });
    createJournalPage(db, {
      id: 'page-2', gameId: 'g1', title: '终章', canvasWidth: 1440, canvasHeight: 1000,
    });

    const updated = saveJournalPage(db, {
      ...page,
      title: '共同线',
      canvasWidth: 1680,
      background: { color: '#fff7e8', pattern: 'dots' },
      tags: ['共通线', '海边'],
      soundtrackTrackId: null,
      blocks: [{
        id: 'note-1', type: 'text', x: 32, y: 44, width: 280, height: 160,
        rotation: 0, zIndex: 1, locked: false, text: '第一次见面的场景',
        color: '#332b28', backgroundColor: '#fff0a8', fontSize: 18, align: 'left',
      }],
    });

    expect(updated.revision).toBe(1);
    expect(getJournalPage(db, page.id)).toMatchObject({
      title: '共同线', canvasWidth: 1680, tags: ['共通线', '海边'], revision: 1,
      blocks: [expect.objectContaining({ id: 'note-1', text: '第一次见面的场景' })],
    });
    expect(listJournalPages(db, 'g1').map((item) => item.id)).toEqual(['page-1', 'page-2']);
    expect(() => saveJournalPage(db, { ...page, title: '过期写入' })).toThrow(/revision/i);
    expect(deleteJournalPage(db, 'page-2')).toBe(true);
    expect(listJournalPages(db, 'g1')).toHaveLength(1);
    db.close();
  });

  it('cascades journal records with a game and nulls a removed soundtrack', () => {
    const db = new Database(':memory:');
    migrate(db);
    createGame(db, { id: 'g1', name: 'ATRI' });
    db.prepare(`INSERT INTO tracks
      (id, game_id, file_path, file_name, file_hash, format, file_size)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('t1', 'g1', 'C:/lib/a.ogg', 'a.ogg', 'h1', 'ogg', 10);
    const page = createJournalPage(db, {
      id: 'page-1', gameId: 'g1', title: '序章', canvasWidth: 1440, canvasHeight: 1000,
      soundtrackTrackId: 't1',
    });
    insertJournalAsset(db, {
      id: 'asset-1', gameId: 'g1', kind: 'image', filePath: 'C:/lib/ATRI/手账/素材/a.png',
      fileName: 'a.png', mimeType: 'image/png', fileSize: 10, fileHash: 'hash-a',
    });

    db.prepare('DELETE FROM tracks WHERE id = ?').run('t1');
    expect(getJournalPage(db, page.id)?.soundtrackTrackId).toBeNull();
    expect(listJournalAssets(db, 'g1')).toHaveLength(1);

    db.prepare('DELETE FROM games WHERE id = ?').run('g1');
    expect(listJournalPages(db, 'g1')).toEqual([]);
    expect(listJournalAssets(db, 'g1')).toEqual([]);
    db.close();
  });
});
