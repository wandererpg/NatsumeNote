import { describe, expect, it } from 'vitest';

import { validateJournalPageDraft } from '../../src/main/ipc/journal-validation';
import type { ReinaPlaySnapshot, ReinaSession } from '../../src/shared/reina';

function session(overrides: Partial<ReinaSession> = {}): ReinaSession {
  return {
    id: 1,
    gameId: 42,
    startTime: '2026-10-20T23:00:00+08:00',
    endTime: '2026-10-20T23:30:00+08:00',
    sourceDate: '2026-10-20',
    recordedMinutes: 30,
    recordedDurationSeconds: 1800,
    durationPrecision: 'minute-rounded',
    trackingMode: 'unknown',
    recordKind: 'unknown',
    ...overrides,
  };
}

function snapshot(overrides: Partial<ReinaPlaySnapshot> = {}): ReinaPlaySnapshot {
  const sessions = overrides.sessions ?? [session()];
  const base: ReinaPlaySnapshot = {
    version: 1,
    sourceApp: 'ReinaManager',
    sourceId: 'reina-main',
    externalGameId: 42,
    externalGameName: 'ATRI -My Dear Moments-',
    fetchedAt: '2026-10-21T09:00:00+08:00',
    sessions,
    stats: {
      sourceTotalMinutes: 6000,
      sourceSessionCount: 80,
      sourceLastPlayed: '2026-10-20T23:30:00+08:00',
      sessionTotalMinutes: sessions.reduce((total, item) => total + item.recordedMinutes, 0),
      sessionCount: sessions.length,
      liveSession: false,
    },
  };
  return { ...base, ...overrides, stats: overrides.stats ?? base.stats };
}

function playBlock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'play-session',
    id: 'card-1',
    x: 96,
    y: 300,
    width: 380,
    height: 300,
    rotation: 0,
    zIndex: 0,
    locked: false,
    snapshot: snapshot(),
    ...overrides,
  };
}

function draftWith(block: Record<string, unknown>) {
  return {
    id: 'page-1',
    gameId: 'game-1',
    title: '第一页',
    position: 0,
    canvasWidth: 960,
    canvasHeight: 680,
    background: { color: '#fffaf0', pattern: 'paper' },
    blocks: [block],
    tags: [],
    soundtrackTrackId: null,
    revision: 0,
  };
}

describe('journal play-session block validation', () => {
  it('accepts a strict historical snapshot and preserves minute precision', () => {
    const parsed = validateJournalPageDraft(draftWith(playBlock()));
    const card = parsed.blocks[0];
    expect(card).toMatchObject({
      type: 'play-session',
      id: 'card-1',
      width: 380,
      snapshot: {
        version: 1,
        sourceApp: 'ReinaManager',
        sourceId: 'reina-main',
        externalGameId: 42,
        externalGameName: 'ATRI -My Dear Moments-',
        fetchedAt: '2026-10-21T09:00:00+08:00',
      },
    });
    if (card.type !== 'play-session') throw new Error('unexpected block type');
    expect(card.snapshot.sessions).toHaveLength(1);
    expect(card.snapshot.sessions[0]).toMatchObject({ recordedMinutes: 30, recordedDurationSeconds: 1800, durationPrecision: 'minute-rounded' });
    expect(card.snapshot.stats).toMatchObject({ sessionCount: 1, sessionTotalMinutes: 30, liveSession: false });
  });

  it('keeps legacy text blocks valid next to the new type', () => {
    const parsed = validateJournalPageDraft(draftWith({
      type: 'text',
      id: 'text-1',
      x: 10,
      y: 20,
      width: 240,
      height: 210,
      rotation: 0,
      zIndex: 1,
      locked: false,
      text: '旧便签',
      color: '#342d2a',
      backgroundColor: '#fff2a8',
      fontSize: 18,
      align: 'left',
    }));
    expect(parsed.blocks[0]).toMatchObject({ type: 'text', text: '旧便签' });
  });

  it('rejects unknown top-level, snapshot, stats and session keys', () => {
    expect(() => validateJournalPageDraft(draftWith(playBlock({ filePath: 'C:/secret/notes.db' })))).toThrow(/filePath is not supported/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: { ...snapshot(), musicPath: 'C:/music/track.ogg' },
    })))).toThrow(/musicPath is not supported/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({
        stats: { ...snapshot().stats, trackId: 'track-1' } as unknown as ReinaPlaySnapshot['stats'],
      }),
    })))).toThrow(/trackId is not supported/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({
        sessions: [{ ...session(), musicDurationSeconds: 240 } as unknown as ReinaSession],
      }),
    })))).toThrow(/musicDurationSeconds is not supported/);
  });

  it('bounds the session list at the insertion cap', () => {
    const many = Array.from({ length: 21 }, (_, index) => session({ id: index + 1 }));
    expect(() => validateJournalPageDraft(draftWith(playBlock({ snapshot: snapshot({ sessions: many }) })))).toThrow(/at most 20 sessions/);
  });

  it('requires ISO timestamps and non-decreasing session ranges', () => {
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ fetchedAt: '2026-10-21 09:00:00' }),
    })))).toThrow(/ISO-8601 date-time/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ sessions: [session({ sourceDate: '2026/10/20' })] }),
    })))).toThrow(/ISO-8601 date/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({
        sessions: [session({ startTime: '2026-10-20T23:30:00+08:00', endTime: '2026-10-20T23:00:00+08:00' })],
      }),
    })))).toThrow(/endTime must be after startTime/);
  });

  it('rejects numeric strings and external game id mismatches', () => {
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ sessions: [session({ recordedMinutes: '30' as unknown as number })] }),
    })))).toThrow(/recordedMinutes is out of range/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ sessions: [session({ gameId: 43 })] }),
    })))).toThrow(/gameId must match snapshot.externalGameId/);
  });

  it('rejects live or internally inconsistent stats', () => {
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ stats: { ...snapshot().stats, liveSession: true } as unknown as ReinaPlaySnapshot['stats'] }),
    })))).toThrow(/liveSession must be false/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ stats: { ...snapshot().stats, sessionTotalMinutes: 999 } }),
    })))).toThrow(/sessionTotalMinutes must match snapshot.sessions/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ stats: { ...snapshot().stats, sessionCount: 5 } }),
    })))).toThrow(/sessionCount must match snapshot.sessions/);
  });

  it('requires positive whole minutes that match the recorded duration', () => {
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ sessions: [session({ recordedMinutes: 0, recordedDurationSeconds: 0 })] }),
    })))).toThrow(/recordedMinutes is out of range/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ sessions: [session({ recordedMinutes: -5 })] }),
    })))).toThrow(/recordedMinutes is out of range/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ sessions: [session({ recordedMinutes: 1.5, recordedDurationSeconds: 90 })] }),
    })))).toThrow(/recordedMinutes is out of range/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ sessions: [session({ recordedMinutes: 30, recordedDurationSeconds: 1799 })] }),
    })))).toThrow(/recordedDurationSeconds must equal recordedMinutes \* 60/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ sessions: [session({ recordedMinutes: 30, recordedDurationSeconds: 1800 })] }),
    })))).not.toThrow();
  });

  it('requires a strictly positive session range and unique session ids', () => {
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({
        sessions: [session({ startTime: '2026-10-20T23:00:00+08:00', endTime: '2026-10-20T23:00:00+08:00' })],
      }),
    })))).toThrow(/endTime must be after startTime/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({
        sessions: [
          session(),
          session({ id: 1, startTime: '2026-10-19T20:00:00+08:00', endTime: '2026-10-19T20:30:00+08:00' }),
        ],
      }),
    })))).toThrow(/id must be unique within snapshot.sessions/);
  });

  it('rejects impossible calendar dates instead of letting Date.parse normalize them', () => {
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ fetchedAt: '2026-02-30T09:00:00+08:00' }),
    })))).toThrow(/ISO-8601 date-time/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ sessions: [session({ sourceDate: '2026-02-30' })] }),
    })))).toThrow(/ISO-8601 date/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ sessions: [session({ sourceDate: '2026-13-01' })] }),
    })))).toThrow(/ISO-8601 date/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ sessions: [session({ startTime: '2026-10-20T24:00:00+08:00' })] }),
    })))).toThrow(/ISO-8601 date-time/);
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ sessions: [session({ startTime: '2026-10-20T23:00:60+08:00' })] }),
    })))).toThrow(/ISO-8601 date-time/);
    // 2024 is a leap year, 2026 is not.
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({
        sessions: [session({
          startTime: '2024-02-29T20:00:00+08:00',
          endTime: '2024-02-29T20:30:00+08:00',
          sourceDate: '2024-02-29',
        })],
      }),
    })))).not.toThrow();
    expect(() => validateJournalPageDraft(draftWith(playBlock({
      snapshot: snapshot({ sessions: [session({ sourceDate: '2026-02-29' })] }),
    })))).toThrow(/ISO-8601 date/);
  });
});
