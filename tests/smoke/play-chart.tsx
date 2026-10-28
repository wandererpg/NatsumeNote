import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReinaGamePanel } from '../../src/renderer/src/features/reina/ReinaGamePanel';
import type { ReinaQuery, ReinaSession, ReinaStats } from '../../src/shared/reina';
import '../../src/renderer/src/styles/globals.css';

const mode = new URLSearchParams(location.search).get('mode') ?? 'default';
const source = { id: 'play-smoke', label: 'ReinaManager · 合成测试来源', connectedAt: '2026-10-01T00:00:00Z' };
const queries: { tool: string; input: ReinaQuery }[] = [];
const localDate = (year: number, month: number, day: number, hour = 20, minute = 0) => new Date(year, month - 1, day, hour, minute).toISOString();
const session = (id: number, startTime: string, minutes: number): ReinaSession => ({
  id, gameId: 42, startTime,
  endTime: new Date(new Date(startTime).getTime() + minutes * 60_000).toISOString(),
  sourceDate: startTime.slice(0, 10), recordedMinutes: minutes, recordedDurationSeconds: minutes * 60,
  durationPrecision: 'minute-rounded', trackingMode: 'unknown', recordKind: 'unknown',
});
const allSessions = mode === 'empty' ? [] : mode === 'single'
  ? [session(1, localDate(2026, 10, 3), 95)]
  : mode === 'long'
    ? [session(1, localDate(1970, 1, 1), 45), session(2, localDate(2026, 10, 27), 130)]
    : [
      ...Array.from({ length: 100 }, (_, index) => session(index + 1, localDate(2026, 10, 1, 12, 0), 10)),
      session(101, localDate(2026, 10, 1), 20),
      session(102, localDate(2026, 10, 3, 23, 30), 60),
      session(103, localDate(2026, 10, 5), 75),
    ];
const stats: ReinaStats = {
  sourceTotalMinutes: mode === 'empty' ? 99 : mode === 'single' ? 95 : mode === 'long' ? 175 : 1199,
  sourceSessionCount: allSessions.length,
  sourceLastPlayed: allSessions.at(-1)?.endTime ?? null,
  sessionTotalMinutes: allSessions.reduce((total, entry) => total + entry.recordedMinutes, 0),
  sessionCount: allSessions.length, liveSession: false,
};
const envelope = (data: unknown, nextCursor: string | null = null) => ({
  contractVersion: 1, sourceApp: 'ReinaManager', sourceId: source.id, snapshotId: 'play-smoke-snapshot',
  fetchedAt: localDate(2026, 10, 27), warnings: ['来源累计与已保存会话合计不一致；两种口径分别展示。'], data, nextCursor,
});
const name = mode === 'long' ? '天津罪 · アマツツミ · 长作品标题与数据来源名称换行展示 '.repeat(9) : '天津罪 · アマツツミ';
Object.defineProperty(window, '__playSmoke', { value: { queries, mode, expectedSessionCount: allSessions.length } });
Object.defineProperty(window, 'galMusic', { value: {
  reinaSources: async () => [source],
  reinaLinks: async () => [{ localGameId: 'local', sourceId: source.id, externalGameId: 42, externalName: name }],
  reinaQuery: async (tool: string, input: ReinaQuery) => {
    queries.push({ tool, input });
    if (tool === 'reina_get_stats') return envelope(stats);
    if (tool === 'reina_list_sessions') {
      return input.cursor === 'page-2'
        ? envelope(allSessions.slice(100))
        : envelope(allSessions.slice(0, 100), allSessions.length > 100 ? 'page-2' : null);
    }
    return envelope([]);
  },
  reinaUnbind: async () => {},
} });
document.documentElement.dataset.theme = mode === 'light' ? 'aquarium-glass' : 'rain-afterglow';
createRoot(document.getElementById('root')!).render(
  <main style={{ width: mode === 'narrow' ? 680 : 'calc(100% - 80px)', maxWidth: 1080, margin: '24px auto', paddingBottom: 24, minWidth: 0 }}>
    <ReinaGamePanel gameId="local" gameName={name} />
  </main>,
);
