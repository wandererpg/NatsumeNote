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
  /** Read every page before publishing history, for complete daily charts. */
  loadAll?: boolean;
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
 * Loads stats and saved sessions from the same snapshot. With loadAll, every
 * page is collected before publishing history. Refreshes create a new snapshot
 * and preserve the previous complete history until all new pages arrive.
 * A generation counter discards responses belonging to an older request.
 */
export function useReinaSessions({
  sourceId,
  gameId,
  from,
  to,
  pageSize = DEFAULT_PAGE_SIZE,
  loadAll = false,
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
        if (loadAll && !snapshotId) {
          throw new Error('游玩记录快照不可用，请刷新重试。');
        }

        let sessionsEnvelope = await bridge.reinaQuery<ReinaSession[]>('reina_list_sessions', {
          sourceId,
          gameId,
          limit: pageSize,
          ...range,
          ...(snapshotId ? { snapshotId } : {}),
        });
        if (!isCurrent()) return;

        let sessions = asReinaList<ReinaSession>(sessionsEnvelope.data, 'sessions');
        let warnings = mergeWarnings(statsEnvelope.warnings, sessionsEnvelope.warnings);
        let fetchedAt = sessionsEnvelope.fetchedAt || statsEnvelope.fetchedAt || null;
        let nextCursor = sessionsEnvelope.nextCursor ?? null;
        const cursors = new Set<string>();
        if (loadAll && sessionsEnvelope.snapshotId !== snapshotId) {
          throw new Error('游玩记录快照已变化，请刷新重试。');
        }
        while (loadAll && nextCursor) {
          if (cursors.has(nextCursor)) {
            throw new Error('游玩记录分页已失效，请刷新重试。');
          }
          cursors.add(nextCursor);
          sessionsEnvelope = await bridge.reinaQuery<ReinaSession[]>('reina_list_sessions', {
            sourceId,
            gameId,
            limit: pageSize,
            ...range,
            snapshotId: snapshotId!,
            cursor: nextCursor,
          });
          if (!isCurrent()) return;
          if (sessionsEnvelope.snapshotId !== snapshotId) {
            throw new Error('游玩记录快照已变化，请刷新重试。');
          }
          sessions = mergeSessions(sessions, asReinaList<ReinaSession>(sessionsEnvelope.data, 'sessions'));
          warnings = mergeWarnings(warnings, sessionsEnvelope.warnings);
          fetchedAt = sessionsEnvelope.fetchedAt || fetchedAt;
          nextCursor = sessionsEnvelope.nextCursor ?? null;
        }
        setState({
          stats,
          sessions,
          warnings,
          fetchedAt,
          snapshotId: sessionsEnvelope.snapshotId || snapshotId,
          nextCursor,
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
    [enabled, sourceId, gameId, from, to, pageSize, loadAll],
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
