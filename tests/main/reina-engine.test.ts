import { describe, expect, it } from 'vitest';
import { ReinaQueryEngine } from '../../src/main/reina/engine';
const session = (id: number) => ({ id, gameId: 42, startTime: '2026-10-01T10:00:00.000Z', endTime: '2026-10-01T11:00:00.000Z', sourceDate: '2026-10-01', recordedMinutes: 12, recordedDurationSeconds: 720, durationPrecision: 'minute-rounded' as const, trackingMode: 'unknown' as const, recordKind: 'unknown' as const });
const stats = { sourceTotalMinutes: 99, sourceSessionCount: 3, sourceLastPlayed: null };
function fixture() {
  let rows = [session(2), session(1)];
  const engine = new ReinaQueryEngine(() => ({ connection: () => ({ readable: true as const, liveSession: false as const, schemaProfile: 'test' }), games: () => [{id:42,name:'Synthetic',externalIds:[],tags:[],unsupportedTagProviders:[]}], snapshot: () => ({ sessions: structuredClone(rows), stats }), close: () => {} }));
  return { engine, change: () => { rows = [session(3)]; } };
}
describe('Reina materialized MCP snapshots', () => {
  it('uses null for connection diagnostics and rejects nonexistent games', () => {
    const { engine } = fixture();
    expect(engine.call('/a','reina_get_connection',{sourceId:'s'}).snapshotId).toBeNull();
    for (const tool of ['reina_get_tags','reina_list_sessions','reina_get_stats']) {
      expect(() => engine.call('/a',tool,{sourceId:'s',gameId:999})).toThrow('作品不存在');
    }
  });
  it('derives subrange stats from an existing snapshot without rereading changed source', () => {
    const { engine, change } = fixture();
    const first = engine.call('/a','reina_list_sessions',{sourceId:'s',gameId:42});
    change();
    const total = engine.call('/a','reina_get_stats',{sourceId:'s',gameId:42,snapshotId:first.snapshotId!,from:'2026-10-01T00:00:00Z',to:'2026-10-02T00:00:00Z'});
    expect(total.data).toMatchObject({sessionCount:2,sessionTotalMinutes:24});
    expect(total.warnings.join(' ')).not.toContain('不一致');
    const outside = engine.call('/a','reina_get_stats',{sourceId:'s',gameId:42,snapshotId:first.snapshotId!,from:'2026-10-02T00:00:00Z',to:'2026-10-03T00:00:00Z'});
    expect(outside.data).toMatchObject({sessionCount:0,sessionTotalMinutes:0,sessionLastPlayed:null});
    const scoped = engine.call('/a','reina_list_sessions',{sourceId:'s',gameId:42,from:'2026-10-01T00:00:00Z',to:'2026-10-02T00:00:00Z'});
    expect(() => engine.call('/a','reina_get_stats',{sourceId:'s',gameId:42,snapshotId:scoped.snapshotId!,from:'2026-09-01T00:00:00Z',to:'2026-11-01T00:00:00Z'})).toThrow('范围超出');
  });
  it('keeps pages and totals consistent across source changes, then refreshes', () => {
    const { engine, change } = fixture();
    const first = engine.call('/authorized.db', 'reina_list_sessions', { sourceId: 's', gameId: 42, limit: 1 });
    expect(first.nextCursor).toBeTruthy(); change();
    const next = engine.call('/authorized.db', 'reina_list_sessions', { sourceId: 's', gameId: 42, limit: 1, cursor: first.nextCursor! });
    expect((next.data as ReturnType<typeof session>[])[0].id).toBe(1);
    const total = engine.call('/authorized.db', 'reina_get_stats', { sourceId: 's', gameId: 42, snapshotId: first.snapshotId });
    expect(total.data).toMatchObject({ sessionTotalMinutes: 24, sessionCount: 2, sourceTotalMinutes: 99, liveSession: false });
    expect(total.warnings.join(' ')).toContain('不一致');
    expect(total.warnings.join(' ')).toContain('缺失值');
    expect(total.data).toMatchObject({ sessionLastPlayed: '2026-10-01T11:00:00.000Z' });
    const refreshed = engine.call('/authorized.db', 'reina_list_sessions', { sourceId: 's', gameId: 42 });
    expect((refreshed.data as unknown[]).length).toBe(1);
  });
  it('rejects cross-source, game and range cursor reuse', () => {
    const { engine } = fixture();
    const first = engine.call('/a', 'reina_list_sessions', { sourceId: 's', gameId: 42, limit: 1 });
    for (const extra of [{ sourceId: 'other' }, { gameId: 43 }, { from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }]) {
      expect(() => engine.call('/a', 'reina_list_sessions', { sourceId: 's', gameId: 42, cursor: first.nextCursor!, ...extra })).toThrow();
    }
  });
  it('does not compare range totals against source lifetime totals', () => {
    const { engine } = fixture();
    const total = engine.call('/a', 'reina_get_stats', { sourceId: 's', gameId: 42, from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' });
    expect(total.warnings.join(' ')).not.toContain('不一致');
  });
  it('rejects unknown fields, invalid dates, missing range endpoints and excessive limits', () => {
    const { engine } = fixture();
    for (const extra of [{ path: 'secret' }, { limit: 101 }, { from: 'today' }, { from: '2026-02-30T00:00:00Z', to: '2026-03-02T00:00:00Z' }]) {
      expect(() => engine.call('/a', 'reina_list_sessions', { sourceId: 's', gameId: 42, ...extra })).toThrow();
    }
  });
  it('expires snapshots and invalidates them on disconnect', () => {
    const { engine } = fixture();
    const first = engine.call('/a', 'reina_list_sessions', { sourceId: 's', gameId: 42, limit: 1 });
    engine.invalidate('s');
    expect(() => engine.call('/a', 'reina_list_sessions', { sourceId: 's', gameId: 42, snapshotId: first.snapshotId })).toThrow();
  });
});
