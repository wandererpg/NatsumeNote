import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReinaSession, ReinaStats } from '../../../../shared/reina';
import { getReinaBridge, hasBridgeMethod, reinaErrorMessage } from './reina-bridge';
import { asReinaList, asReinaStats, mergeSessions, mergeWarnings } from './reina-data';
import { notifyReinaTagsChanged } from './reina-events';

export interface ReinaSessionsQuery {
  sourceId: string | null;
  gameId: number | null;
  from?: string;
  to?: string;
  pageSize?: number;
  enabled?: boolean;
}

export interface ReinaSessionsState {
  stats: ReinaStats | null;
  sessions: ReinaSession[];
  warnings: string[];
  fetchedAt: string | null;
  snapshotId: string | null;
  nextCursor: string | null;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  /** Content is displayed but is not the newest result (refresh in flight or failed). */
  stale: boolean;
  error: string | null;
  loadMoreError: string | null;
}

export interface ReinaSessionsResult extends ReinaSessionsState {
  hasMore: boolean;
  refresh: () => void;
  loadMore: () => void;
}

const DEFAULT_PAGE_SIZE = 20;

function emptyState(): ReinaSessionsState {
  return {
    stats: null,
    sessions: [],
    warnings: [],
    fetchedAt: null,
    snapshotId: null,
    nextCursor: null,
    loading: false,
    refreshing: false,
    loadingMore: false,
    stale: false,
    error: null,
    loadMoreError: null,
  };
}

/**
 * Loads `reina_get_stats` and the first page of `reina_list_sessions` from the
 * same snapshot. A refresh intentionally drops the old snapshot id so the main
 * process creates a new one; the previous content stays visible and is marked
 * stale until the new snapshot arrives. Old responses are discarded by a
 * per-instance generation counter.
 */
export function useReinaSessions({
  sourceId,
  gameId,
  from,
  to,
  pageSize = DEFAULT_PAGE_SIZE,
  enabled = true,
}: ReinaSessionsQuery): ReinaSessionsResult {
  const [state, setState] = useState<ReinaSessionsState>(emptyState);
  const stateRef = useRef(state);
  const mountedRef = useRef(false);
  const requestRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  const runLoad = useCallback(
    async (keepPrevious: boolean) => {
      if (!enabled || sourceId === null || gameId === null) return;
      const bridge = getReinaBridge();
      if (!bridge || !hasBridgeMethod(bridge, 'reinaQuery')) return;

      const request = requestRef.current + 1;
      requestRef.current = request;
      const isCurrent = (): boolean => mountedRef.current && request === requestRef.current;

      setState((previous) => {
        const hasData = previous.stats !== null || previous.sessions.length > 0;
        if (keepPrevious && hasData) {
          return {
            ...previous,
            refreshing: true,
            stale: true,
            error: null,
            loadMoreError: null,
          };
        }
        return { ...emptyState(), loading: true };
      });

      const range = {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      };

      try {
        const statsEnvelope = await bridge.reinaQuery<ReinaStats>('reina_get_stats', {
          sourceId,
          gameId,
          ...range,
        });
        if (!isCurrent()) return;

        const stats = asReinaStats(statsEnvelope.data);
        const snapshotId = statsEnvelope.snapshotId ? statsEnvelope.snapshotId : null;

        const sessionsEnvelope = await bridge.reinaQuery<ReinaSession[]>('reina_list_sessions', {
          sourceId,
          gameId,
          limit: pageSize,
          ...range,
          ...(snapshotId ? { snapshotId } : {}),
        });
        if (!isCurrent()) return;

        setState({
          stats,
          sessions: asReinaList<ReinaSession>(sessionsEnvelope.data, 'sessions'),
          warnings: mergeWarnings(statsEnvelope.warnings, sessionsEnvelope.warnings),
          fetchedAt: sessionsEnvelope.fetchedAt || statsEnvelope.fetchedAt || null,
          snapshotId: sessionsEnvelope.snapshotId || snapshotId,
          nextCursor: sessionsEnvelope.nextCursor ?? null,
          loading: false,
          refreshing: false,
          loadingMore: false,
          stale: false,
          error: null,
          loadMoreError: null,
        });
        // A successful refresh means the source database may have gained new
        // tags or sessions; the global tag index should reload.
        if (keepPrevious) notifyReinaTagsChanged();
      } catch (loadError) {
        if (!isCurrent()) return;
        const message = reinaErrorMessage(loadError, '无法读取 ReinaManager 游玩记录，请稍后重试。');
        setState((previous) => {
          const hasData = previous.stats !== null || previous.sessions.length > 0;
          if (keepPrevious && hasData) {
            return {
              ...previous,
              loading: false,
              refreshing: false,
              stale: true,
              error: message,
              loadMoreError: null,
            };
          }
          return { ...emptyState(), error: message };
        });
      }
    },
    [enabled, sourceId, gameId, from, to, pageSize],
  );

  useEffect(() => {
    if (!enabled || sourceId === null || gameId === null) {
      requestRef.current += 1;
      setState(emptyState());
      return;
    }
    const bridge = getReinaBridge();
    if (!bridge || !hasBridgeMethod(bridge, 'reinaQuery')) {
      setState({
        ...emptyState(),
        error: '当前版本未接入 ReinaManager 查询接口，无法读取游玩记录。',
      });
      return;
    }
    void runLoad(false);
  }, [enabled, sourceId, gameId, from, to, runLoad]);

  const refresh = useCallback(() => {
    void runLoad(true);
  }, [runLoad]);

  const loadMore = useCallback(() => {
    const current = stateRef.current;
    const bridge = getReinaBridge();
    if (sourceId === null || gameId === null) return;
    if (!bridge || !hasBridgeMethod(bridge, 'reinaQuery')) return;
    if (!current.nextCursor || current.loading || current.refreshing || current.loadingMore) return;

    const cursor = current.nextCursor;
    const snapshotId = current.snapshotId;
    const request = requestRef.current + 1;
    requestRef.current = request;
    const isCurrent = (): boolean => mountedRef.current && request === requestRef.current;

    setState((previous) => ({ ...previous, loadingMore: true, loadMoreError: null }));

    const range = {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };

    void (async () => {
      try {
        const envelope = await bridge.reinaQuery<ReinaSession[]>('reina_list_sessions', {
          sourceId,
          gameId,
          limit: pageSize,
          cursor,
          ...range,
          ...(snapshotId ? { snapshotId } : {}),
        });
        if (!isCurrent()) return;
        setState((previous) => ({
          ...previous,
          sessions: mergeSessions(previous.sessions, asReinaList<ReinaSession>(envelope.data, 'sessions')),
          warnings: mergeWarnings(previous.warnings, envelope.warnings),
          fetchedAt: envelope.fetchedAt || previous.fetchedAt,
          snapshotId: envelope.snapshotId || previous.snapshotId,
          nextCursor: envelope.nextCursor ?? null,
          loadingMore: false,
          loadMoreError: null,
        }));
      } catch (loadError) {
        if (!isCurrent()) return;
        setState((previous) => ({
          ...previous,
          loadingMore: false,
          loadMoreError: reinaErrorMessage(loadError, '加载更多会话失败，请重试。'),
        }));
      }
    })();
  }, [sourceId, gameId, from, to, pageSize]);

  return { ...state, hasMore: Boolean(state.nextCursor), refresh, loadMore };
}
