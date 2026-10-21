import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ReinaAPI,
  ReinaEnvelope,
  ReinaLink,
  ReinaPlaySnapshot,
  ReinaSession,
  ReinaStats,
} from '../../../../shared/reina';
import './journal-play-session.css';
import {
  MAX_PLAY_SESSION_CARD_SESSIONS,
  PLAY_SESSION_QUERY_LIMIT,
  buildPlaySnapshot,
  clampPlaySessions,
  errorMessage,
  formatPlayDate,
  formatPlayMinutes,
  formatPlaySessionRange,
  formatSnapshotFetchedAt,
  isIsoDateTime,
  isInsertablePlaySession,
  mergePlaySessions,
  pickPlaySessions,
  readPlaySessionList,
  readPlayStats,
  sortPlaySessions,
  sumPlayMinutes,
} from './journal-play-session';

type PlaySessionBridge = Partial<ReinaAPI> | undefined;
type LinksState = 'loading' | 'ready' | 'unavailable' | 'error';
type PlayState = 'idle' | 'loading' | 'ready' | 'error';

export interface PlaySessionPickerProps {
  gameId: string;
  disabled?: boolean;
  onInsert(snapshot: ReinaPlaySnapshot): void;
}

function getBridge(): PlaySessionBridge {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { galMusic?: Partial<ReinaAPI> }).galMusic;
}

function linkKey(link: ReinaLink): string {
  return `${link.sourceId}\u0000${link.externalGameId}`;
}

/** A data-tool result without a snapshot id cannot be used safely. */
function requireSnapshotId(envelope: ReinaEnvelope<unknown>): string {
  if (!envelope || typeof envelope.snapshotId !== 'string' || envelope.snapshotId.trim().length === 0) {
    throw new Error('数据源未返回游玩快照标识');
  }
  return envelope.snapshotId;
}

export function PlaySessionPicker({ gameId, disabled = false, onInsert }: PlaySessionPickerProps) {
  const [links, setLinks] = useState<ReinaLink[]>([]);
  const [linksState, setLinksState] = useState<LinksState>('loading');
  const [linksError, setLinksError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [playState, setPlayState] = useState<PlayState>('idle');
  const [playError, setPlayError] = useState<string | null>(null);
  const [stats, setStats] = useState<ReinaStats | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ReinaSession[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(() => new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  /** Bumped for every new request; late responses from an older generation are dropped. */
  const requestIdRef = useRef(0);

  const loadLinks = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLinks([]);
    setLinksState('loading');
    setLinksError(null);
    setActiveKey(null);
    setPlayState('idle');
    setPlayError(null);
    setStats(null);
    setSnapshotId(null);
    setFetchedAt(null);
    setSessions([]);
    setNextCursor(null);
    setSelectedIds(new Set());
    setLoadingMore(false);
    setHint(null);
    const reinaLinks = getBridge()?.reinaLinks;
    if (!reinaLinks) {
      if (requestId === requestIdRef.current) setLinksState('unavailable');
      return;
    }
    try {
      const next = await reinaLinks(gameId);
      if (requestId !== requestIdRef.current) return;
      setLinks(next);
      setLinksState('ready');
      setActiveKey(next.length > 0 ? linkKey(next[0]) : null);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setLinksState('error');
      setLinksError(errorMessage(error));
    }
  }, [gameId]);

  useEffect(() => {
    void loadLinks();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadLinks]);

  const loadPlay = useCallback(async (link: ReinaLink) => {
    const requestId = ++requestIdRef.current;
    setPlayState('loading');
    setPlayError(null);
    setHint(null);
    setStats(null);
    setSnapshotId(null);
    setFetchedAt(null);
    setSessions([]);
    setNextCursor(null);
    setSelectedIds(new Set());
    setLoadingMore(false);
    const reinaQuery = getBridge()?.reinaQuery;
    if (link.needsConfirmation) {
      setPlayState('error');
      setPlayError('来源数据库已重新选择，请先在作品概览中解除旧关联并重新确认作品。');
      return;
    }
    if (!reinaQuery) {
      setPlayState('error');
      setPlayError('主进程暂未提供 Reina 数据查询桥接');
      return;
    }
    try {
      const statsEnvelope = await reinaQuery<ReinaStats>('reina_get_stats', {
        sourceId: link.sourceId,
        gameId: link.externalGameId,
      });
      if (requestId !== requestIdRef.current) return;
      const statsSnapshotId = requireSnapshotId(statsEnvelope);
      const sourceStats = readPlayStats(statsEnvelope.data);
      const sessionsEnvelope = await reinaQuery<ReinaSession[]>('reina_list_sessions', {
        sourceId: link.sourceId,
        gameId: link.externalGameId,
        limit: PLAY_SESSION_QUERY_LIMIT,
        snapshotId: statsSnapshotId,
      });
      if (requestId !== requestIdRef.current) return;
      requireSnapshotId(sessionsEnvelope);
      if (sessionsEnvelope.snapshotId !== statsSnapshotId) throw new Error('游玩记录快照不一致，请重试');
      // Records that cannot be stored as a validated minute-precision card entry
      // (zero minutes, mismatched second counts, empty ranges) are never offered.
      const pageSessions = sortPlaySessions(readPlaySessionList(sessionsEnvelope.data)).filter(isInsertablePlaySession);
      setSnapshotId(statsSnapshotId);
      setStats(sourceStats);
      setFetchedAt(isIsoDateTime(sessionsEnvelope.fetchedAt) ? sessionsEnvelope.fetchedAt : new Date().toISOString());
      setSessions(pageSessions);
      setSelectedIds(new Set(pageSessions.slice(0, MAX_PLAY_SESSION_CARD_SESSIONS).map((session) => session.id)));
      setNextCursor(typeof sessionsEnvelope.nextCursor === 'string' && sessionsEnvelope.nextCursor.length > 0 ? sessionsEnvelope.nextCursor : null);
      setPlayState('ready');
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setPlayState('error');
      setPlayError(errorMessage(error));
    }
  }, []);

  const activeLink = links.find((link) => linkKey(link) === activeKey) ?? null;

  useEffect(() => {
    if (linksState !== 'ready') return;
    if (!activeKey) {
      setPlayState('idle');
      return;
    }
    const link = links.find((item) => linkKey(item) === activeKey);
    if (!link) return;
    void loadPlay(link);
    return () => {
      requestIdRef.current += 1;
    };
  }, [activeKey, links, linksState, loadPlay]);

  const selectedSessions = pickPlaySessions(sessions, selectedIds);
  let selectedMinutes = 0;
  try {
    selectedMinutes = sumPlayMinutes(selectedSessions);
  } catch {
    selectedMinutes = 0;
  }
  const sourceTotalLabel = stats && stats.sourceTotalMinutes !== null ? formatPlayMinutes(stats.sourceTotalMinutes) : '未提供';

  const toggleSession = (sessionId: number) => {
    if (!selectedIds.has(sessionId) && selectedIds.size >= MAX_PLAY_SESSION_CARD_SESSIONS) {
      setHint(`最多选择 ${MAX_PLAY_SESSION_CARD_SESSIONS} 条记录`);
      return;
    }
    const next = new Set(selectedIds);
    if (next.has(sessionId)) next.delete(sessionId);
    else next.add(sessionId);
    setSelectedIds(next);
    setHint(null);
  };

  const selectAll = () => {
    setSelectedIds(new Set(clampPlaySessions(sessions).map((session) => session.id)));
    setHint(null);
  };

  const loadMore = async () => {
    if (!activeLink || !nextCursor || loadingMore || playState !== 'ready') return;
    const reinaQuery = getBridge()?.reinaQuery;
    if (!reinaQuery) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    setPlayError(null);
    try {
      const envelope = await reinaQuery<ReinaSession[]>('reina_list_sessions', {
        sourceId: activeLink.sourceId,
        gameId: activeLink.externalGameId,
        limit: PLAY_SESSION_QUERY_LIMIT,
        cursor: nextCursor,
        snapshotId: snapshotId ?? undefined,
      });
      if (requestId !== requestIdRef.current) return;
      requireSnapshotId(envelope);
      if (snapshotId && envelope.snapshotId !== snapshotId) throw new Error('数据源快照已变化，请刷新后重试');
      setSessions((current) => mergePlaySessions(current, readPlaySessionList(envelope.data).filter(isInsertablePlaySession)));
      setNextCursor(typeof envelope.nextCursor === 'string' && envelope.nextCursor.length > 0 ? envelope.nextCursor : null);
    } catch (error) {
      if (requestId === requestIdRef.current) setPlayError(errorMessage(error));
    } finally {
      // A newer request resets its own loading flag; a stale request must not clear it.
      if (requestId === requestIdRef.current) setLoadingMore(false);
    }
  };

  const insertCard = () => {
    if (!activeLink || !stats || !fetchedAt) return;
    let snapshot: ReinaPlaySnapshot;
    try {
      snapshot = buildPlaySnapshot({
        sourceId: activeLink.sourceId,
        externalGameId: activeLink.externalGameId,
        externalGameName: activeLink.externalName,
        fetchedAt,
        sessions: selectedSessions,
        stats,
      });
    } catch (error) {
      setHint(errorMessage(error));
      return;
    }
    onInsert(snapshot);
    setHint(`已插入 ${snapshot.stats.sessionCount} 条记录 · 截至 ${formatSnapshotFetchedAt(snapshot.fetchedAt)}`);
  };

  return (
    <section className="journal-play-session" aria-label="游玩记录">
      <div className="journal-play-session__head">
        <div className="journal-play-session__title"><span>游玩记录</span><small>ReinaManager</small></div>
        {linksState === 'ready' && links.length > 1 && (
          <select
            aria-label="选择 Reina 绑定来源"
            value={activeKey ?? ''}
            onChange={(event) => setActiveKey(event.target.value)}
          >
            {links.map((link) => <option key={linkKey(link)} value={linkKey(link)}>{link.externalName}</option>)}
          </select>
        )}
      </div>

      {linksState === 'loading' && <p className="journal-play-session__hint" role="status">读取 Reina 绑定…</p>}
      {linksState === 'unavailable' && <p className="journal-play-session__hint">主进程暂未提供 Reina 桥接</p>}
      {linksState === 'error' && (
        <div className="journal-play-session__message" role="alert">
          <p className="journal-play-session__hint is-error">读取绑定失败：{linksError}</p>
          <button className="button button--ghost" type="button" onClick={() => void loadLinks()}>重试</button>
        </div>
      )}
      {linksState === 'ready' && links.length === 0 && (
        <p className="journal-play-session__hint">尚未绑定 Reina 来源，先在设置中完成绑定。</p>
      )}

      {linksState === 'ready' && activeLink && playState === 'loading' && (
        <p className="journal-play-session__hint" role="status">读取游玩记录…</p>
      )}
      {linksState === 'ready' && activeLink && playState === 'error' && (
        <div className="journal-play-session__message" role="alert">
          <p className="journal-play-session__hint is-error">读取游玩记录失败：{playError}</p>
          <button className="button button--ghost" type="button" onClick={() => void loadPlay(activeLink)}>重试</button>
        </div>
      )}

      {linksState === 'ready' && activeLink && playState === 'ready' && (
        <>
          <div className="journal-play-session__summary">
            <strong>{activeLink.externalName}</strong>
            <span>来源累计：{sourceTotalLabel}</span>
            <span>快照 {sessions.length} 条 · 已选 {selectedSessions.length} 条 · {formatPlayMinutes(selectedMinutes)}</span>
            <span>只统计游玩记录，不含音乐时长。</span>
          </div>
          {sessions.length === 0 ? (
            <p className="journal-play-session__hint">这个来源没有已确认的游玩记录。</p>
          ) : (
            <ul className="journal-play-session__list">
              {sessions.map((session) => (
                <li key={session.id}>
                  <label className="journal-play-session__row">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(session.id)}
                      onChange={() => toggleSession(session.id)}
                      aria-label={`选择 ${formatPlayDate(session)} ${formatPlaySessionRange(session)} 的游玩记录`}
                    />
                    <span className="journal-play-session__row-copy">
                      <span className="journal-play-session__row-top">
                        <span>{formatPlayDate(session)}</span>
                        <span>{session.recordedMinutes} 分</span>
                      </span>
                      <small>{formatPlaySessionRange(session)}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="journal-play-session__actions">
            <button className="button button--ghost" type="button" onClick={selectAll} disabled={sessions.length === 0}>全选</button>
            <button className="button button--ghost" type="button" onClick={() => void loadPlay(activeLink)}><RefreshCw size={11} />刷新</button>
            {nextCursor && (
              <button className="button button--ghost" type="button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? '加载中…' : '加载更多'}</button>
            )}
            <button
              className="button button--ghost is-primary"
              type="button"
              onClick={insertCard}
              disabled={disabled || selectedSessions.length === 0}
            >插入卡片（{selectedSessions.length}）</button>
          </div>
          {playError && <p className="journal-play-session__hint is-error" role="alert">{playError}</p>}
          {hint && <p className="journal-play-session__hint" role="status">{hint}</p>}
          <p className="journal-play-session__footnote">插入的是历史快照，来源删除或刷新后卡片仍会保留。</p>
        </>
      )}
    </section>
  );
}
