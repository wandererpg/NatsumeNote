/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReinaEnvelope, ReinaSession, ReinaStats } from '../../src/shared/reina';
import { useReinaSessions } from '../../src/renderer/src/features/reina/useReinaSessions';

function envelope<T>(data: T, nextCursor: string | null = null, snapshotId = 'snapshot-1'): ReinaEnvelope<T> {
  return {
    contractVersion: 1, sourceApp: 'ReinaManager', sourceId: 'source-1', snapshotId,
    fetchedAt: '2026-10-27T08:00:00Z', warnings: [], data, nextCursor,
  };
}

function stats(minutes: number): ReinaStats {
  return {
    sourceTotalMinutes: minutes, sourceSessionCount: 2, sourceLastPlayed: null,
    sessionTotalMinutes: minutes, sessionCount: 2, liveSession: false,
  };
}

function session(id: number, gameId = 42): ReinaSession {
  return {
    id, gameId, startTime: '2026-10-26T12:00:00Z', endTime: '2026-10-26T12:30:00Z',
    sourceDate: '2026-10-26', recordedMinutes: 30, recordedDurationSeconds: 1800,
    durationPrecision: 'minute-rounded', trackingMode: 'unknown', recordKind: 'unknown',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function installBridge(reinaQuery: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, 'galMusic', { configurable: true, value: { reinaQuery } });
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { galMusic?: unknown }).galMusic;
});

describe('complete Reina play history', () => {
  it('keeps manual pagination for callers that do not opt in', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(envelope(stats(60)))
      .mockResolvedValueOnce(envelope([session(1)], 'page-2'));
    installBridge(query);
    const { result } = renderHook(() => useReinaSessions({ sourceId: 'source-1', gameId: 42 }));
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(query).toHaveBeenCalledTimes(2);
    expect(result.current.hasMore).toBe(true);
  });

  it('collects all pages in one snapshot before showing any history', async () => {
    const lastPage = deferred<ReinaEnvelope<ReinaSession[]>>();
    const query = vi.fn()
      .mockResolvedValueOnce(envelope(stats(60)))
      .mockResolvedValueOnce(envelope([session(1)], 'page-2'))
      .mockReturnValueOnce(lastPage.promise);
    installBridge(query);
    const { result } = renderHook(() => useReinaSessions({
      sourceId: 'source-1', gameId: 42, loadAll: true, pageSize: 100,
    }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(3));
    expect(result.current.loading).toBe(true);
    expect(result.current.sessions).toEqual([]);
    expect(result.current.stats).toBeNull();
    expect(query.mock.calls[1][1]).toEqual({ sourceId: 'source-1', gameId: 42, limit: 100, snapshotId: 'snapshot-1' });
    expect(query.mock.calls[2][1]).toEqual({ sourceId: 'source-1', gameId: 42, limit: 100, snapshotId: 'snapshot-1', cursor: 'page-2' });
    await act(async () => lastPage.resolve(envelope([session(1), session(2)])));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions.map((entry) => entry.id)).toEqual([1, 2]);
    expect(result.current.stats?.sourceTotalMinutes).toBe(60);
    expect(result.current.hasMore).toBe(false);
  });

  it('does not present an incomplete first load when a later page fails', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(envelope(stats(60)))
      .mockResolvedValueOnce(envelope([session(1)], 'page-2'))
      .mockRejectedValueOnce(new Error('下一页读取失败'));
    installBridge(query);
    const { result } = renderHook(() => useReinaSessions({ sourceId: 'source-1', gameId: 42, loadAll: true }));
    await waitFor(() => expect(result.current.error).toBe('下一页读取失败'));
    expect(result.current.sessions).toEqual([]);
    expect(result.current.stats).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('keeps the last complete history if refreshing a later page fails', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(envelope(stats(30)))
      .mockResolvedValueOnce(envelope([session(1)]))
      .mockResolvedValueOnce(envelope(stats(60), null, 'snapshot-2'))
      .mockResolvedValueOnce(envelope([session(2)], 'page-2', 'snapshot-2'))
      .mockRejectedValueOnce(new Error('刷新失败'));
    installBridge(query);
    const { result } = renderHook(() => useReinaSessions({ sourceId: 'source-1', gameId: 42, loadAll: true }));
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBe('刷新失败'));
    expect(result.current.sessions.map((entry) => entry.id)).toEqual([1]);
    expect(result.current.stats?.sourceTotalMinutes).toBe(30);
    expect(result.current.snapshotId).toBe('snapshot-1');
    expect(result.current.stale).toBe(true);
    expect(result.current.refreshing).toBe(false);
  });

  it('discards a pending old page when switching games', async () => {
    const oldPage = deferred<ReinaEnvelope<ReinaSession[]>>();
    const query = vi.fn()
      .mockResolvedValueOnce(envelope(stats(60)))
      .mockResolvedValueOnce(envelope([session(1)], 'old-page-2'))
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce(envelope(stats(90), null, 'new-snapshot'))
      .mockResolvedValueOnce(envelope([session(9, 77)], null, 'new-snapshot'));
    installBridge(query);
    const { result, rerender } = renderHook(({ gameId }) => useReinaSessions({
      sourceId: 'source-1', gameId, loadAll: true,
    }), { initialProps: { gameId: 42 } });
    await waitFor(() => expect(query).toHaveBeenCalledTimes(3));
    rerender({ gameId: 77 });
    await waitFor(() => expect(result.current.sessions[0]?.gameId).toBe(77));
    await act(async () => oldPage.resolve(envelope([session(2)], 'old-page-3')));
    expect(query).toHaveBeenCalledTimes(5);
    expect(result.current.sessions.map((entry) => entry.id)).toEqual([9]);
    expect(result.current.snapshotId).toBe('new-snapshot');
  });

  it('stops when a source repeats a pagination cursor', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(envelope(stats(60)))
      .mockResolvedValueOnce(envelope([session(1)], 'page-2'))
      .mockResolvedValueOnce(envelope([session(2)], 'page-2'));
    installBridge(query);
    const { result } = renderHook(() => useReinaSessions({ sourceId: 'source-1', gameId: 42, loadAll: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.sessions).toEqual([]);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('rejects pages from a different snapshot', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(envelope(stats(60)))
      .mockResolvedValueOnce(envelope([session(1)], 'page-2'))
      .mockResolvedValueOnce(envelope([session(2)], null, 'different-snapshot'));
    installBridge(query);
    const { result } = renderHook(() => useReinaSessions({ sourceId: 'source-1', gameId: 42, loadAll: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.sessions).toEqual([]);
  });
});
