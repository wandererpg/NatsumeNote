import { describe, expect, it } from 'vitest';

import {
  MAX_PLAY_SESSION_CARD_SESSIONS,
  buildPlaySnapshot,
  clampPlaySessions,
  describePlaySnapshot,
  formatPlayDate,
  formatPlayMinutes,
  formatPlaySessionRange,
  formatSnapshotFetchedAt,
  isInsertablePlaySession,
  isIsoDateTime,
  mergePlaySessions,
  pickPlaySessions,
  readPlaySessionList,
  readPlayStats,
  sortPlaySessions,
  sumPlayMinutes,
} from '../../src/renderer/src/features/journal/journal-play-session';
import {
  addJournalBlock,
  createBlankJournalPage,
  createJournalPlaySessionBlock,
  duplicateJournalBlock,
} from '../../src/renderer/src/features/journal/journal-model';
import { commitJournalHistory, createJournalHistory, undoJournalHistory } from '../../src/renderer/src/features/journal/journal-history';
import { journalPageToSvg } from '../../src/renderer/src/features/journal/journal-export';
import type { ReinaPlaySnapshot, ReinaSession, ReinaStats } from '../../src/shared/reina';

function clockPlus(startTime: string, minutes: number): string {
  const [hours, mins] = startTime.slice(11, 16).split(':').map(Number);
  const total = hours * 60 + mins + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`;
}

function session(id: number, startTime: string, recordedMinutes: number, gameId = 42): ReinaSession {
  return {
    id,
    gameId,
    startTime,
    endTime: `${startTime.slice(0, 11)}${clockPlus(startTime, recordedMinutes)}${startTime.slice(19)}`,
    sourceDate: startTime.slice(0, 10),
    recordedMinutes,
    recordedDurationSeconds: recordedMinutes * 60,
    durationPrecision: 'minute-rounded',
    trackingMode: 'unknown',
    recordKind: 'unknown',
  };
}

const sourceStats: ReinaStats = {
  sourceTotalMinutes: 6000,
  sourceSessionCount: 220,
  sourceLastPlayed: '2026-10-20T23:45:00+08:00',
  sessionTotalMinutes: 4000,
  sessionCount: 200,
  liveSession: false,
};

function buildFixture(): ReinaPlaySnapshot {
  return buildPlaySnapshot({
    sourceId: 'reina-main',
    externalGameId: 42,
    externalGameName: 'ATRI -My Dear Moments-',
    fetchedAt: '2026-10-21T09:00:00+08:00',
    sessions: [
      session(1, '2026-10-18T21:00:00+08:00', 30),
      session(2, '2026-10-20T23:00:00+08:00', 45),
    ],
    stats: sourceStats,
  });
}

describe('play-session snapshot builder', () => {
  it('stores a frozen newest-first snapshot whose counters only count play minutes', () => {
    const snapshot = buildFixture();

    expect(snapshot).toMatchObject({
      version: 1,
      sourceApp: 'ReinaManager',
      sourceId: 'reina-main',
      externalGameId: 42,
      externalGameName: 'ATRI -My Dear Moments-',
      fetchedAt: '2026-10-21T09:00:00+08:00',
    });
    expect(snapshot.sessions.map((item) => item.id)).toEqual([2, 1]);
    expect(snapshot.stats).toEqual({
      sourceTotalMinutes: 6000,
      sourceSessionCount: 220,
      sourceLastPlayed: '2026-10-20T23:45:00+08:00',
      sessionTotalMinutes: 75,
      sessionCount: 2,
      liveSession: false,
    });
    expect(Object.keys(snapshot)).toEqual(['version', 'sourceApp', 'sourceId', 'externalGameId', 'externalGameName', 'fetchedAt', 'sessions', 'stats']);
    expect(Object.keys(snapshot.stats)).not.toContain('musicTotalMinutes');
    expect(Object.keys(snapshot.sessions[0])).not.toContain('musicDurationSeconds');
    expect(snapshot.stats.sessionTotalMinutes).toBe(75);
  });

  it('deduplicates, caps at the insertion limit and never exceeds safe integers', () => {
    const many = Array.from({ length: 25 }, (_, index) => session(index + 1, `2026-10-${String(index + 1).padStart(2, '0')}T20:00:00+08:00`, 10));
    const withDuplicate = [...many, session(25, '2026-10-25T21:00:00+08:00', 10)];
    const clamped = clampPlaySessions(withDuplicate);
    expect(clamped).toHaveLength(MAX_PLAY_SESSION_CARD_SESSIONS);
    expect(new Set(clamped.map((item) => item.id)).size).toBe(MAX_PLAY_SESSION_CARD_SESSIONS);

    const snapshot = buildPlaySnapshot({
      sourceId: 'reina-main',
      externalGameId: 42,
      externalGameName: 'ATRI',
      fetchedAt: '2026-10-21T09:00:00+08:00',
      sessions: many,
      stats: sourceStats,
    });
    expect(snapshot.sessions).toHaveLength(MAX_PLAY_SESSION_CARD_SESSIONS);
    expect(snapshot.stats.sessionCount).toBe(MAX_PLAY_SESSION_CARD_SESSIONS);
    expect(snapshot.stats.sessionTotalMinutes).toBe(MAX_PLAY_SESSION_CARD_SESSIONS * 10);
    expect(() => sumPlayMinutes([session(1, '2026-10-18T21:00:00+08:00', 1.5)])).toThrow('游玩记录分钟数无效');
    expect(() => buildPlaySnapshot({
      sourceId: 'reina-main',
      externalGameId: 42,
      externalGameName: 'ATRI',
      fetchedAt: '2026-10-21T09:00:00+08:00',
      sessions: [session(1, '2026-10-18T21:00:00+08:00', 30, 43)],
      stats: sourceStats,
    })).toThrow('游玩记录与外部作品不一致');
  });

  it('merges paged results and keeps only the selected sessions for insertion', () => {
    const first = [session(1, '2026-10-18T21:00:00+08:00', 30)];
    const second = [session(1, '2026-10-18T21:00:00+08:00', 30), session(2, '2026-10-20T23:00:00+08:00', 45)];
    const merged = mergePlaySessions(first, second);
    expect(merged.map((item) => item.id)).toEqual([2, 1]);
    expect(pickPlaySessions(merged, new Set([1])).map((item) => item.id)).toEqual([1]);
    expect(pickPlaySessions(merged, new Set())).toEqual([]);
  });

  it('reads documented payloads and their defensive wrappers', () => {
    const sessions = readPlaySessionList([session(1, '2026-10-18T21:00:00+08:00', 30)]);
    expect(sessions).toHaveLength(1);
    expect(readPlaySessionList({ sessions })).toHaveLength(1);
    expect(() => readPlaySessionList([{ id: 1 }])).toThrow('游玩记录数据格式无法识别');

    expect(readPlayStats(sourceStats)).toEqual(sourceStats);
    expect(readPlayStats({ stats: sourceStats })).toEqual(sourceStats);
    expect(() => readPlayStats({})).toThrow('游玩统计格式无法识别');
  });

  it('formats minute-precision labels without timezone drift', () => {
    expect(formatPlayMinutes(0)).toBe('0 分钟');
    expect(formatPlayMinutes(45)).toBe('45 分钟');
    expect(formatPlayMinutes(60)).toBe('1 小时');
    expect(formatPlayMinutes(200)).toBe('3 小时 20 分钟');
    const sample = session(1, '2026-10-20T23:05:00+08:00', 30);
    expect(formatPlaySessionRange(sample)).toBe('23:05–23:35');
    expect(formatPlayDate(sample)).toBe('2026-10-20');
    expect(formatSnapshotFetchedAt('2026-10-21T09:00:00.000Z')).toBe('2026-10-21 09:00');
    expect(describePlaySnapshot(buildFixture())).toBe('ATRI -My Dear Moments- · 2 次 · 1 小时 15 分钟 · 截至 2026-10-21 09:00');
  });

  it('orders sessions by absolute time while labels keep each source wall clock', () => {
    // 2026-10-20T01:00+08:00 is 2026-10-19T17:00Z; the second record is 22:00Z,
    // i.e. chronologically newer even though its raw string sorts earlier.
    const earlier = session(1, '2026-10-20T01:00:00+08:00', 30);
    const later = session(2, '2026-10-19T22:00:00+00:00', 30);
    expect(sortPlaySessions([earlier, later]).map((item) => item.id)).toEqual([2, 1]);
    expect(sortPlaySessions([later, earlier]).map((item) => item.id)).toEqual([2, 1]);
    // Display stays on the record's own wall clock and source date.
    expect(formatPlaySessionRange(earlier)).toBe('01:00–01:30');
    expect(formatPlayDate(earlier)).toBe('2026-10-20');
    expect(formatPlaySessionRange(later)).toBe('22:00–22:30');
    expect(formatPlayDate(later)).toBe('2026-10-19');
  });

  it('rejects records that cannot become a positive minute-precision card entry', () => {
    const valid = session(1, '2026-10-18T21:00:00+08:00', 30);
    expect(isInsertablePlaySession(valid)).toBe(true);
    expect(isInsertablePlaySession({ ...valid, recordedMinutes: 0, recordedDurationSeconds: 0 })).toBe(false);
    expect(isInsertablePlaySession({ ...valid, recordedMinutes: 30, recordedDurationSeconds: 1799 })).toBe(false);
    expect(isInsertablePlaySession({ ...valid, endTime: valid.startTime })).toBe(false);
    expect(isInsertablePlaySession({ ...valid, endTime: '2026-10-18T20:00:00+08:00' })).toBe(false);
    expect(() => sumPlayMinutes([{ ...valid, recordedMinutes: 0, recordedDurationSeconds: 0 }])).toThrow('游玩记录分钟数无效');
    expect(() => buildPlaySnapshot({
      sourceId: 'reina-main',
      externalGameId: 42,
      externalGameName: 'ATRI',
      fetchedAt: '2026-10-21T09:00:00+08:00',
      sessions: [{ ...valid, recordedDurationSeconds: 1801 }],
      stats: sourceStats,
    })).toThrow('游玩记录时长无效');
  });

  it('rejects normalized calendar dates in the snapshot timestamp', () => {
    expect(isIsoDateTime('2026-10-21T09:00:00+08:00')).toBe(true);
    expect(isIsoDateTime('2024-02-29T09:00:00Z')).toBe(true);
    expect(isIsoDateTime('2026-02-30T09:00:00+08:00')).toBe(false);
    expect(isIsoDateTime('2026-02-29T09:00:00+08:00')).toBe(false);
    expect(isIsoDateTime('2026-10-21T24:00:00+08:00')).toBe(false);
    expect(() => buildPlaySnapshot({
      sourceId: 'reina-main',
      externalGameId: 42,
      externalGameName: 'ATRI',
      fetchedAt: '2026-02-30T09:00:00+08:00',
      sessions: [session(1, '2026-10-18T21:00:00+08:00', 30)],
      stats: sourceStats,
    })).toThrow('快照时间无效');
  });
});

describe('play-session card behaviour', () => {
  it('creates a detached card snapshot that survives duplicate and undo', () => {
    const snapshot = buildFixture();
    const block = createJournalPlaySessionBlock('card-1', snapshot);
    expect(block).toMatchObject({ type: 'play-session', x: 96, y: 300, width: 380, height: 300 });
    expect(block.snapshot).not.toBe(snapshot);
    expect(block.snapshot.sessions).not.toBe(snapshot.sessions);

    snapshot.sessions[0].recordedMinutes = 999;
    expect(block.snapshot.sessions[0].recordedMinutes).toBe(45);

    const page = addJournalBlock(createBlankJournalPage('game-1', 'page-1', '第一页'), block);
    const copied = duplicateJournalBlock(page, block.id, 'card-2');
    expect(copied.blocks).toHaveLength(2);
    expect(copied.blocks[1]).toMatchObject({ type: 'play-session', id: 'card-2', x: 124, y: 328 });
    if (copied.blocks[1].type !== 'play-session') throw new Error('unexpected block type');
    expect(copied.blocks[1].snapshot.stats.sessionTotalMinutes).toBe(75);

    const undone = undoJournalHistory(commitJournalHistory(createJournalHistory(page), copied));
    expect(undone.present.blocks).toHaveLength(1);
  });

  it('exports the card as a historical snapshot in SVG', () => {
    const page = addJournalBlock(
      createBlankJournalPage('game-1', 'page-1', '第一页'),
      createJournalPlaySessionBlock('card-1', buildFixture()),
    );
    const svg = journalPageToSvg(page, { gameName: 'ATRI & <memory>', tracks: [], assets: [] });

    expect(svg).toContain('游玩记录');
    expect(svg).toContain('ATRI -My Dear Moments-');
    expect(svg).toContain('1 小时 15 分钟');
    expect(svg).toContain('2 次 · 截至 2026-10-21 09:00');
    expect(svg).toContain('2026-10-20 23:00–23:45 · 45 分钟');
    expect(svg).not.toContain('音乐片段');
  });
});
