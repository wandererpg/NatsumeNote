import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Gamepad2,
  Info,
  Link2,
  LoaderCircle,
  RefreshCw,
  Search,
  Unlink,
} from 'lucide-react';
import type { ReinaGame, ReinaLink, ReinaQuery } from '../../../../shared/reina';
import type { GameMetadataSummary } from '../../../../shared/types';
import { getReinaBridge, hasBridgeMethod, reinaErrorMessage, type ReinaBridge } from './reina-bridge';
import { useReinaSources } from './useReinaSources';
import { useReinaSessions } from './useReinaSessions';
import { ReinaHistoryPreview } from './ReinaHistoryPreview';
import { asReinaList, mergeGames, mergeWarnings } from './reina-data';
import {
  dayStartIso,
  durationPrecisionLabel,
  formatDateTime,
  formatMinutes,
  formatSessionCount,
  formatSessionRange,
  formatSourceDate,
  nextDayStartIso,
  providerLabel,
  trackingModeLabel,
} from './reina-format';
import './reina.css';
import { notifyReinaTagsChanged } from './reina-events';

export interface ReinaGamePanelProps {
  gameId: string;
  gameName: string;
}

type SearchMode = 'name' | 'vndb' | 'bangumi';

type MatchedExternalIds = Partial<Record<'vndb' | 'bangumi', string>>;

type MetadataBridge = {
  getGameMetadata?: (gameId: string) => Promise<GameMetadataSummary>;
};

function candidateMatchesMetadata(candidate: ReinaGame, matched: MatchedExternalIds): boolean {
  return (Array.isArray(candidate.externalIds) ? candidate.externalIds : []).some(
    (entry) => matched[entry.provider] === entry.id,
  );
}

interface CandidateSearchState {
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  warnings: string[];
  nextCursor: string | null;
  fetchedAt: string | null;
  loaded: boolean;
  searchedFor: string;
}

const CANDIDATE_PAGE_SIZE = 20;

function emptySearchState(): CandidateSearchState {
  return {
    loading: false,
    loadingMore: false,
    error: null,
    warnings: [],
    nextCursor: null,
    fetchedAt: null,
    loaded: false,
    searchedFor: '',
  };
}

function WarningList({ warnings, label = '来源提示' }: { warnings: string[]; label?: string }) {
  return (
    <div className="reina-warnings" role="status" aria-label={label}>
      <p className="reina-warnings__title">
        <Info size={13} aria-hidden="true" />
        来源提示
      </p>
      <ul>
        {warnings.map((warning, index) => (
          <li key={`${index}-${warning}`}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Read-only ReinaManager play history for one local game. Association is
 * always explicit: choosing a candidate only selects it, and the user must
 * confirm with "关联此作品". Stats and sessions are requested only while a
 * link exists for the selected source.
 */
export function ReinaGamePanel({ gameId, gameName }: ReinaGamePanelProps) {
  const {
    sources,
    loading: sourcesLoading,
    error: sourcesError,
    reload: reloadSources,
    bridgeReady,
  } = useReinaSources();

  const [sourceId, setSourceId] = useState('');
  const [links, setLinks] = useState<ReinaLink[] | null>(null);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(gameName);
  const [searchMode, setSearchMode] = useState<SearchMode>('name');
  const [externalId, setExternalId] = useState('');
  const [candidates, setCandidates] = useState<ReinaGame[] | null>(null);
  const [searchState, setSearchState] = useState<CandidateSearchState>(emptySearchState);
  const [selectedCandidate, setSelectedCandidate] = useState<ReinaGame | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [binding, setBinding] = useState(false);
  const [unbinding, setUnbinding] = useState(false);
  const [unbindArmed, setUnbindArmed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [matchedExternalIds, setMatchedExternalIds] = useState<MatchedExternalIds>({});

  const mountedRef = useRef(false);
  const linksRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const searchPendingRef = useRef(false);
  const lastSearchRef = useRef<{ query: ReinaQuery; label: string } | null>(null);
  const autoSelectedRef = useRef(false);
  const gameIdRef = useRef(gameId);
  const sourceIdRef = useRef(sourceId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      linksRequestRef.current += 1;
      searchRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    gameIdRef.current = gameId;
  }, [gameId]);

  useEffect(() => {
    sourceIdRef.current = sourceId;
  }, [sourceId]);

  // Recommendation only: read the metadata already matched for this local game
  // so candidates whose external id matches can be highlighted. This never
  // selects or binds a candidate automatically.
  useEffect(() => {
    setMatchedExternalIds({});
    const bridge = getReinaBridge() as (ReinaBridge & MetadataBridge) | null;
    const getMetadata = bridge?.getGameMetadata;
    if (!bridge || typeof getMetadata !== 'function') return;
    let cancelled = false;
    void (async () => {
      try {
        const summary = await getMetadata.call(bridge, gameId);
        if (cancelled) return;
        const next: MatchedExternalIds = {};
        const matchedSources = Array.isArray(summary?.sources) ? summary.sources : [];
        for (const entry of matchedSources) {
          if (entry.status !== 'matched') continue;
          if (entry.source !== 'vndb' && entry.source !== 'bangumi') continue;
          if (typeof entry.externalId !== 'string') continue;
          const externalId = entry.externalId.trim();
          if (externalId) next[entry.source] = externalId;
        }
        setMatchedExternalIds(next);
      } catch {
        // Auxiliary recommendation data: failures are intentionally silent.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  // Reset per-game state when the external game id (or its display name) changes.
  useEffect(() => {
    autoSelectedRef.current = false;
    linksRequestRef.current += 1;
    searchRequestRef.current += 1;
    searchPendingRef.current = false;
    setSourceId('');
    setLinks(null);
    setLinksError(null);
    setCandidates(null);
    setSearchState(emptySearchState());
    setSelectedCandidate(null);
    setSearchQuery(gameName);
    setSearchMode('name');
    setExternalId('');
    setFromDate('');
    setToDate('');
    setUnbindArmed(false);
    setActionError(null);
    setStatusMessage(null);
  }, [gameId, gameName]);

  const loadLinks = async () => {
    const bridge = getReinaBridge();
    const request = linksRequestRef.current + 1;
    linksRequestRef.current = request;
    const isCurrent = (): boolean => mountedRef.current && request === linksRequestRef.current;

    if (!bridge || !hasBridgeMethod(bridge, 'reinaLinks')) {
      if (isCurrent()) {
        setLinks(null);
        setLinksError('当前版本未接入 ReinaManager 关联接口。');
        setLinksLoading(false);
      }
      return;
    }

    setLinksLoading(true);
    setLinksError(null);
    try {
      const list = await bridge.reinaLinks(gameId);
      if (!isCurrent()) return;
      setLinks(Array.isArray(list) ? list : []);
    } catch (loadError) {
      if (!isCurrent()) return;
      setLinksError(reinaErrorMessage(loadError, '无法读取此作品已有的 ReinaManager 关联。'));
    } finally {
      if (isCurrent()) setLinksLoading(false);
    }
  };

  useEffect(() => {
    void loadLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // Reset search when the selected source changes; results belong to one source.
  useEffect(() => {
    searchRequestRef.current += 1;
    searchPendingRef.current = false;
    lastSearchRef.current = null;
    setCandidates(null);
    setSearchState(emptySearchState());
    setSelectedCandidate(null);
    setActionError(null);
    setStatusMessage(null);
  }, [sourceId]);

  // Pick a source once both sources and this game's links are known, preferring
  // the source that is already associated with the game.
  useEffect(() => {
    if (autoSelectedRef.current || !sources) return;
    if (!links && !linksError) return;
    const stillValid = sourceId !== '' && sources.some((source) => source.id === sourceId);
    const linked = links?.find((link) => sources.some((source) => source.id === link.sourceId));
    const next = stillValid ? sourceId : (linked?.sourceId ?? sources[0]?.id ?? '');
    if (!next) return;
    setSourceId(next);
    autoSelectedRef.current = true;
  }, [sources, links, linksError, sourceId]);

  const boundLink: ReinaLink | null = sourceId
    ? (links?.find((link) => link.sourceId === sourceId) ?? null)
    : null;
  const sourceLabel = sources?.find((source) => source.id === sourceId)?.label ?? '';
  const externalGameId = boundLink && !boundLink.needsConfirmation ? boundLink.externalGameId : null;

  const fromIso = fromDate ? dayStartIso(fromDate) : null;
  const toIso = toDate ? nextDayStartIso(toDate) : null;
  const rangeError = fromDate && !fromIso
    ? '开始日期无效。'
    : toDate && !toIso
      ? '结束日期无效。'
      : fromDate && toDate && fromDate > toDate
        ? '开始日期不能晚于结束日期。'
        : null;
  const rangeActive = Boolean(fromDate || toDate) && !rangeError;

  const play = useReinaSessions({
    sourceId: sourceId || null,
    gameId: externalGameId,
    from: fromIso ?? undefined,
    to: toIso ?? undefined,
    pageSize: 20,
    enabled: Boolean(boundLink) && !rangeError && !linksLoading,
  });

  const recommendedCandidateIds = useMemo(() => {
    const matches = new Set<number>();
    for (const candidate of candidates ?? []) {
      if (candidateMatchesMetadata(candidate, matchedExternalIds)) matches.add(candidate.id);
    }
    return matches;
  }, [candidates, matchedExternalIds]);

  const orderedCandidates = useMemo(() => {
    if (!candidates) return null;
    if (recommendedCandidateIds.size === 0) return candidates;
    return [
      ...candidates.filter((candidate) => recommendedCandidateIds.has(candidate.id)),
      ...candidates.filter((candidate) => !recommendedCandidateIds.has(candidate.id)),
    ];
  }, [candidates, recommendedCandidateIds]);

  const staleSuffix = play.fetchedAt
    ? `（读取于 ${formatDateTime(play.fetchedAt) ?? play.fetchedAt}）`
    : '';

  const searchCandidates = async (cursor: string | null = null, browseAll = false, retry = false) => {
    if (searchPendingRef.current) return;
    if (!sourceId) {
      setActionError('请先选择数据来源。');
      return;
    }
    const bridge = getReinaBridge();
    if (!bridge || !hasBridgeMethod(bridge, 'reinaQuery')) {
      setActionError('当前版本未接入 ReinaManager 查询接口。');
      return;
    }
    const trimmedQuery = searchQuery.trim();
    const trimmedExternal = externalId.trim();
    const reuseSearch = (cursor !== null || retry) && lastSearchRef.current !== null;
    if (!reuseSearch && !browseAll && searchMode === 'name' && trimmedQuery.length > 200) {
      setActionError('搜索关键词不能超过 200 个字符。');
      return;
    }
    if (!reuseSearch && !browseAll && searchMode !== 'name' && trimmedExternal === '') {
      setActionError(`请输入 ${providerLabel(searchMode)} 资料 ID。`);
      return;
    }

    const searchLabel = browseAll ? '全部来源作品' : searchMode === 'name'
      ? `名称「${trimmedQuery || '（空）'}」`
      : `${providerLabel(searchMode)} ID「${trimmedExternal}」`;

    searchPendingRef.current = true;
    const request = searchRequestRef.current + 1;
    searchRequestRef.current = request;
    const isCurrent = (): boolean => mountedRef.current && request === searchRequestRef.current;

    setActionError(null);
    setStatusMessage(null);
    if (cursor === null) setCandidates(null);
    setSearchState((previous) => ({
      ...previous,
      loading: cursor === null,
      loadingMore: cursor !== null,
      error: null,
    }));

    const query: ReinaQuery = browseAll ? { sourceId, limit: CANDIDATE_PAGE_SIZE } : searchMode === 'name'
      ? { sourceId, query: trimmedQuery || undefined, limit: CANDIDATE_PAGE_SIZE }
      : { sourceId, externalId: trimmedExternal, provider: searchMode, limit: CANDIDATE_PAGE_SIZE };
    const search = reuseSearch && lastSearchRef.current ? lastSearchRef.current : { query, label: searchLabel };
    lastSearchRef.current = search;

    try {
      const envelope = await bridge.reinaQuery<ReinaGame[]>(
        'reina_list_games',
        cursor ? { ...search.query, cursor } : search.query,
      );
      if (!isCurrent()) return;
      const games = asReinaList<ReinaGame>(envelope.data, 'games');
      setCandidates((previous) => (cursor && previous ? mergeGames(previous, games) : games));
      setSearchState({
        loading: false,
        loadingMore: false,
        error: null,
        warnings: mergeWarnings(Array.isArray(envelope.warnings) ? envelope.warnings : []),
        nextCursor: envelope.nextCursor ?? null,
        fetchedAt: envelope.fetchedAt || null,
        loaded: true,
        searchedFor: search.label,
      });
      if (cursor === null) setSelectedCandidate(null);
    } catch (searchError) {
      if (!isCurrent()) return;
      setSearchState((previous) => ({
        ...previous,
        loading: false,
        loadingMore: false,
        error: reinaErrorMessage(searchError, '搜索 ReinaManager 游戏失败。'),
      }));
    } finally {
      if (isCurrent()) searchPendingRef.current = false;
    }
  };

  const bindSelected = async () => {
    if (!selectedCandidate || !sourceId || binding) return;
    const bridge = getReinaBridge();
    if (!bridge || !hasBridgeMethod(bridge, 'reinaBind')) {
      setActionError('当前版本未接入 ReinaManager 关联接口。');
      return;
    }
    const targetGameId = gameId;
    const targetSourceId = sourceId;
    const candidate = selectedCandidate;
    setBinding(true);
    setActionError(null);
    setStatusMessage(null);
    try {
      await bridge.reinaBind({
        localGameId: targetGameId,
        sourceId: targetSourceId,
        externalGameId: candidate.id,
        externalName: candidate.name,
      });
      notifyReinaTagsChanged();
      if (
        !mountedRef.current
        || gameIdRef.current !== targetGameId
        || sourceIdRef.current !== targetSourceId
      ) {
        return;
      }
      setSelectedCandidate(null);
      setStatusMessage(`已关联《${candidate.name}》的游玩记录。`);
      await loadLinks();
    } catch (bindError) {
      if (mountedRef.current && gameIdRef.current === targetGameId) {
        setActionError(reinaErrorMessage(bindError, '关联此作品失败。'));
      }
    } finally {
      if (mountedRef.current) setBinding(false);
    }
  };

  const confirmUnbind = async () => {
    if (!boundLink || !sourceId || unbinding) return;
    const bridge = getReinaBridge();
    if (!bridge || !hasBridgeMethod(bridge, 'reinaUnbind')) {
      setActionError('当前版本未接入 ReinaManager 解绑接口。');
      return;
    }
    const targetGameId = gameId;
    const targetSourceId = sourceId;
    const linkedName = boundLink.externalName;
    setUnbinding(true);
    setActionError(null);
    setStatusMessage(null);
    try {
      await bridge.reinaUnbind(targetGameId, targetSourceId);
      notifyReinaTagsChanged();
      if (
        !mountedRef.current
        || gameIdRef.current !== targetGameId
        || sourceIdRef.current !== targetSourceId
      ) {
        return;
      }
      setUnbindArmed(false);
      setStatusMessage(`已解除与《${linkedName}》的关联；ReinaManager 中的记录不会被删除。`);
      await loadLinks();
    } catch (unbindError) {
      if (mountedRef.current && gameIdRef.current === targetGameId) {
        setActionError(reinaErrorMessage(unbindError, '解绑失败。'));
      }
    } finally {
      if (mountedRef.current) setUnbinding(false);
    }
  };

  const hasPlayData = play.stats !== null || play.sessions.length > 0;

  return (
    <div className="reina-panel reina-game-panel">
      <header className="reina-panel__header">
        <div>
          <p className="reina-eyebrow">
            <Gamepad2 size={13} aria-hidden="true" />
            REINAMANAGER
          </p>
          <h2 className="reina-panel__heading" id="reina-game-heading">
            游玩记录
          </h2>
          <p className="reina-panel__subtitle">
            只读读取 ReinaManager 中《{gameName}》的已保存游玩时段与累计统计；不会修改来源数据库，也不会删除其中内容。
          </p>
        </div>
      </header>

      {!bridgeReady && (
        <p className="reina-error" role="alert">
          当前版本未接入 ReinaManager 桥接（window.galMusic），无法读取游玩记录。
        </p>
      )}

      <section className="reina-section" aria-labelledby="reina-source-title">
        <div className="reina-section__heading">
          <h3 id="reina-source-title">数据来源</h3>
          <button
            className="reina-link-button"
            type="button"
            onClick={() => void reloadSources()}
            disabled={sourcesLoading}
          >
            <RefreshCw className={sourcesLoading ? 'spin' : undefined} size={12} aria-hidden="true" />
            刷新来源
          </button>
        </div>

        {sourcesLoading && !sources ? (
          <p className="reina-loading" role="status">
            <LoaderCircle className="spin" size={15} aria-hidden="true" />
            正在读取已连接的来源…
          </p>
        ) : sourcesError && bridgeReady ? (
          <div className="reina-error" role="alert">
            <span>{sourcesError}</span>
            <button className="reina-link-button" type="button" onClick={() => void reloadSources()}>
              重试
            </button>
          </div>
        ) : sources && sources.length > 0 ? (
          <>
            <label className="reina-field">
              <span>ReinaManager 来源</span>
              <select
                value={sourceId}
                onChange={(event) => {
                  autoSelectedRef.current = true;
                  setSourceId(event.target.value);
                }}
                disabled={!bridgeReady || sourcesLoading}
                aria-label="ReinaManager 来源"
              >
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label || 'ReinaManager 数据库'}
                  </option>
                ))}
              </select>
            </label>
            {!boundLink && !linksLoading && !linksError && (
              <p className="reina-hint">数据库已连接，此作品尚未关联。请选择对应的来源作品，确认后即可读取已有历史时长；连接数据库不会自动匹配作品。</p>
            )}
          </>
        ) : (
          <p className="reina-hint">
            尚未连接任何 ReinaManager 数据来源。请先在「设置 → 数据连接」中选择 <code>reina_manager.db</code>。
          </p>
        )}
      </section>

      {sourceId && (
        <section className="reina-section" aria-labelledby="reina-binding-title">
          <div className="reina-section__heading">
            <h3 id="reina-binding-title">作品关联</h3>
            <span className="reina-chip">{sourceLabel || '未知来源'}</span>
          </div>

          {statusMessage && (
            <p className="reina-status" role="status">
              {statusMessage}
            </p>
          )}
          {actionError && (
            <p className="reina-error" role="alert">
              {actionError}
            </p>
          )}

          {linksLoading && !links ? (
            <p className="reina-loading" role="status">
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
              正在读取此作品已有的关联…
            </p>
          ) : linksError ? (
            <div className="reina-error" role="alert">
              <span>{linksError}</span>
              <button className="reina-link-button" type="button" onClick={() => void loadLinks()}>
                重试
              </button>
            </div>
          ) : boundLink ? (
            <div className="reina-bound">
              <div className="reina-bound__copy">
                <p className="reina-bound__name">
                  已关联《{boundLink.externalName || `Reina 游戏 #${boundLink.externalGameId}`}》
                </p>
              {boundLink.needsConfirmation && <p className="reina-notice" role="status">来源数据库已重新选择，旧关联暂不读取。请解除此关联，再搜索并确认对应作品；已有手账卡片保留。</p>}
                <p className="reina-bound__meta">
                  ReinaManager 游戏 #{boundLink.externalGameId} · 来源 {sourceLabel || boundLink.sourceId}
                </p>
              </div>
              {unbindArmed ? (
                <div className="reina-bound__confirm" role="group" aria-label="确认解绑">
                  <p role="alert">解绑只移除本地关联，不会删除 ReinaManager 中的游戏或会话。</p>
                  <div className="reina-bound__confirm-actions">
                    <button
                      className="button button--danger button--small"
                      type="button"
                      onClick={() => void confirmUnbind()}
                      disabled={unbinding}
                    >
                      {unbinding && <LoaderCircle className="spin" size={13} aria-hidden="true" />}
                      {unbinding ? '正在解绑…' : '确认解绑'}
                    </button>
                    <button
                      className="button button--ghost button--small"
                      type="button"
                      onClick={() => setUnbindArmed(false)}
                      disabled={unbinding}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={() => setUnbindArmed(true)}
                  disabled={unbinding}
                >
                  <Unlink size={14} aria-hidden="true" />
                  解绑
                </button>
              )}
            </div>
          ) : (
            <div className="reina-search">
              <button
                className="button button--ghost button--small"
                type="button"
                onClick={() => void searchCandidates(null, true)}
                disabled={searchState.loading || searchState.loadingMore || binding}
              >
                浏览全部来源作品
              </button>
              <p className="reina-hint">两边标题、译名或文件夹名不同？直接浏览全部来源作品，选中后先核对历史时长。</p>
              <div className="reina-search__fields">
                <label className="reina-field reina-field--grow">
                  <span>搜索 ReinaManager 游戏</span>
                  <div className="reina-input-row">
                    <input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={`例如：${gameName}`}
                      maxLength={200}
                      aria-label="搜索 ReinaManager 游戏"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void searchCandidates();
                        }
                      }}
                    />
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() => void searchCandidates()}
                      disabled={searchState.loading || searchState.loadingMore}
                    >
                      <Search size={14} aria-hidden="true" />
                      搜索候选
                    </button>
                  </div>
                </label>
                <label className="reina-field">
                  <span>搜索方式</span>
                  <select
                    value={searchMode}
                    onChange={(event) => setSearchMode(event.target.value as SearchMode)}
                    aria-label="搜索方式"
                  >
                    <option value="name">按名称</option>
                    <option value="vndb">按 VNDB 资料 ID</option>
                    <option value="bangumi">按 Bangumi 资料 ID</option>
                  </select>
                </label>
                {searchMode !== 'name' && (
                  <label className="reina-field">
                    <span>{providerLabel(searchMode)} 资料 ID</span>
                    <input
                      value={externalId}
                      onChange={(event) => setExternalId(event.target.value)}
                      placeholder="如 v123 / 12345"
                      aria-label={`${providerLabel(searchMode)} 资料 ID`}
                    />
                  </label>
                )}
              </div>

              <p className="reina-hint">
                候选来自所选来源。选择候选后必须点「关联此作品」才会保存绑定；取消选择不会改变现有绑定。
              </p>

              {searchState.error && (
                <div className="reina-error" role="alert">
                  <span>{searchState.error}</span>
                  <button className="reina-link-button" type="button" onClick={() => void searchCandidates(null, false, true)}>
                    重试
                  </button>
                </div>
              )}
              {searchState.warnings.length > 0 && <WarningList warnings={searchState.warnings} />}

              {searchState.loaded && searchState.searchedFor && (
                <p className="reina-hint">
                  候选结果：{searchState.searchedFor}
                  {searchState.fetchedAt ? ` · 读取于 ${formatDateTime(searchState.fetchedAt) ?? searchState.fetchedAt}` : ''}
                </p>
              )}

              {recommendedCandidateIds.size > 0 && (
                <p className="reina-hint reina-hint--recommend" role="status">
                  已按本作品资料库中已匹配的 VNDB/Bangumi 资料 ID 优先推荐候选；仍需手动选择并点「关联此作品」确认，不会自动绑定。
                </p>
              )}

              {searchState.loading ? (
                <p className="reina-loading" role="status">
                  <LoaderCircle className="spin" size={15} aria-hidden="true" />
                  正在搜索候选…
                </p>
              ) : candidates === null ? null : candidates.length === 0 ? (
                <p className="reina-empty">
                  没有找到匹配的游戏。请点击「浏览全部来源作品」核对不同译名，也可以换用资料 ID 搜索。
                </p>
              ) : (
                <ul className="reina-candidates" role="radiogroup" aria-label="ReinaManager 游戏候选">
                  {(orderedCandidates ?? []).map((candidate) => {
                    const checked = selectedCandidate?.id === candidate.id;
                    const recommended = recommendedCandidateIds.has(candidate.id);
                    const externalIds = (
                      Array.isArray(candidate.externalIds) ? candidate.externalIds : []
                    )
                      .map((entry) => `${providerLabel(entry.provider)} ${entry.id}`)
                      .join(' · ');
                    const tagNames = [
                      ...new Set(
                        (Array.isArray(candidate.tags) ? candidate.tags : []).map((tag) => tag.name),
                      ),
                    ]
                      .filter(Boolean)
                      .slice(0, 6);
                    const unsupported = Array.isArray(candidate.unsupportedTagProviders)
                      ? candidate.unsupportedTagProviders
                      : [];
                    return (
                      <li key={candidate.id}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          className={`reina-candidate${checked ? ' is-selected' : ''}`}
                          onClick={() => setSelectedCandidate(candidate)}
                          disabled={binding}
                        >
                          <span className="reina-candidate__name">
                            {candidate.name}
                            {recommended && (
                              <span className="reina-candidate__recommend">推荐 · 资料 ID 匹配</span>
                            )}
                          </span>
                          <span className="reina-candidate__meta">
                            Reina #{candidate.id}
                            {externalIds ? ` · ${externalIds}` : ''}
                          </span>
                          {(tagNames.length > 0 || unsupported.length > 0) && (
                            <span className="reina-candidate__tags">
                              {tagNames.map((name) => (
                                <span className="reina-chip" key={name}>
                                  {name}
                                </span>
                              ))}
                              {unsupported.length > 0 && (
                                <span className="reina-candidate__note">
                                  部分来源标签不适用：{unsupported.map((item) => providerLabel(item)).join(' / ')}
                                </span>
                              )}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {searchState.loadingMore && (
                <p className="reina-loading" role="status">
                  <LoaderCircle className="spin" size={15} aria-hidden="true" />
                  正在加载更多候选…
                </p>
              )}
              {searchState.nextCursor && !searchState.loading && (
                <button
                  className="button button--ghost button--small"
                  type="button"
                  onClick={() => void searchCandidates(searchState.nextCursor)}
                  disabled={searchState.loadingMore || binding}
                >
                  <ChevronDown size={14} aria-hidden="true" />
                  加载更多候选
                </button>
              )}

              {candidates !== null && candidates.length > 0 && (
                <div className="reina-confirm">
                  <p role="status">
                    {selectedCandidate
                      ? `已选择《${selectedCandidate.name}》（Reina #${selectedCandidate.id}）`
                      : '尚未选择候选作品。'}
                  </p>
                  {selectedCandidate && (
                    <ReinaHistoryPreview
                      key={`${sourceId}:${selectedCandidate.id}`}
                      sourceId={sourceId}
                      gameId={selectedCandidate.id}
                    />
                  )}
                  <div className="reina-confirm__actions">
                    <button
                      className="button button--primary"
                      type="button"
                      onClick={() => void bindSelected()}
                      disabled={!selectedCandidate || binding}
                    >
                      {binding ? (
                        <LoaderCircle className="spin" size={14} aria-hidden="true" />
                      ) : (
                        <Link2 size={14} aria-hidden="true" />
                      )}
                      {binding ? '正在关联…' : '关联此作品'}
                    </button>
                    {selectedCandidate && (
                      <button
                        className="button button--ghost button--small"
                        type="button"
                        onClick={() => setSelectedCandidate(null)}
                        disabled={binding}
                      >
                        取消选择
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {boundLink && !boundLink.needsConfirmation && (
        <section
          className="reina-section reina-play"
          aria-labelledby="reina-play-title"
          aria-busy={play.loading || play.refreshing || play.loadingMore}
        >
          <div className="reina-play__header">
            <div>
              <h3 id="reina-play-title">已保存的游玩记录</h3>
              <p className="reina-play__source">
                来源 ReinaManager · 上次读取{' '}
                {play.fetchedAt ? (formatDateTime(play.fetchedAt) ?? '时间未知') : '尚未读取'}
              </p>
            </div>
            <button
              className="button button--ghost button--small"
              type="button"
              onClick={play.refresh}
              disabled={play.loading || play.refreshing || Boolean(rangeError)}
            >
              <RefreshCw
                className={play.refreshing ? 'spin' : undefined}
                size={14}
                aria-hidden="true"
              />
              刷新
            </button>
          </div>

          <p className="reina-hint">
            日期按会话开始时间筛选，使用半开区间 [开始, 结束)；跨午夜的记录不会在午夜截断，日期按本机时区转换。
          </p>

          <div className="reina-range">
            <label className="reina-field">
              <span>开始日期</span>
              <input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(event) => setFromDate(event.target.value)}
                aria-label="开始日期"
              />
            </label>
            <label className="reina-field">
              <span>结束日期</span>
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(event) => setToDate(event.target.value)}
                aria-label="结束日期"
              />
            </label>
            <button
              className="reina-link-button"
              type="button"
              onClick={() => {
                setFromDate('');
                setToDate('');
              }}
              disabled={!fromDate && !toDate}
            >
              清除时间范围
            </button>
          </div>

          {rangeError && (
            <p className="reina-error" role="alert">
              <AlertTriangle size={13} aria-hidden="true" /> {rangeError} 未发起读取。
            </p>
          )}

          {!rangeError && (
            <>
              {play.loading ? (
                <p className="reina-loading" role="status">
                  <LoaderCircle className="spin" size={15} aria-hidden="true" />
                  正在读取 ReinaManager 记录…
                </p>
              ) : (
                <>
                  {play.stale && play.refreshing && (
                    <p className="reina-notice" role="status">
                      正在刷新…当前显示上次读取的结果{staleSuffix}。
                    </p>
                  )}
                  {play.stale && play.error && !play.refreshing && (
                    <p className="reina-notice reina-notice--warn" role="alert">
                      读取失败，显示上次结果{staleSuffix}。
                    </p>
                  )}
                  {play.error && !play.stale && !hasPlayData && (
                    <div className="reina-error" role="alert">
                      <span>{play.error}</span>
                      <button className="reina-link-button" type="button" onClick={play.refresh}>
                        重试
                      </button>
                    </div>
                  )}

                  {play.warnings.length > 0 && <WarningList warnings={play.warnings} />}

                  {play.stats ? (
                    <div className="reina-stats" role="group" aria-label="游玩统计（两种口径）">
                      <article className="reina-stat">
                        <h4>来源总计 · 全生命周期</h4>
                        <p className="reina-stat__value">
                          {formatMinutes(play.stats.sourceTotalMinutes)}
                        </p>
                        <p className="reina-stat__meta">
                          {play.stats.sourceSessionCount === null
                            ? '来源会话数未提供'
                            : `来源会话数 ${formatSessionCount(play.stats.sourceSessionCount)}`}
                          ；来源统计的累计分钟，不受当前时间范围影响。
                        </p>
                        <p className="reina-stat__meta">
                          来源保存的最近游玩：
                          {formatDateTime(play.stats.sourceLastPlayed) ?? '来源未提供'}（可能陈旧，仅供参考）
                        </p>
                      </article>
                      <article className="reina-stat reina-stat--sessions">
                        <h4>会话累计 · {rangeActive ? '当前时间范围' : '全部已保存会话'}</h4>
                        <p className="reina-stat__value">{formatMinutes(play.stats.sessionTotalMinutes)}</p>
                      <p className="reina-stat__meta">会话中最近结束：{formatDateTime(play.stats.sessionLastPlayed) ?? '暂无有效会话'}</p>
                        <p className="reina-stat__meta">
                          已保存会话 {formatSessionCount(play.stats.sessionCount)} · 分钟取整求和。
                        </p>
                        <p className="reina-stat__meta">与来源总计口径不同，两者不相加。</p>
                      </article>
                    </div>
                  ) : !play.error ? (
                    <p className="reina-notice">来源统计不可用，仅显示已保存会话列表。</p>
                  ) : null}

                  <ul className="reina-disclaimers">
                    <li>时长来自来源保存的分钟取整值（分钟精度），界面不显示秒级「精确」时长。</li>
                    <li>只包含已保存的会话；进行中的游玩不会显示，也无法得知游戏此刻是否运行（不提供实时计时）。</li>
                    <li>来源未保存计时方式与会话类型，界面不做推断。</li>
                  </ul>

                  <div className="reina-sessions-heading">
                    <h4>会话记录</h4>
                    <span>
                      {play.sessions.length > 0 ? `已加载 ${play.sessions.length} 条` : '暂无记录'}
                      {play.stats && play.stats.sessionCount > play.sessions.length
                        ? ` · 范围内共 ${formatSessionCount(play.stats.sessionCount)}`
                        : ''}
                    </span>
                  </div>

                  {play.sessions.length === 0 ? (
                    <p className="reina-empty">此时间范围内没有已保存的会话。来源只保留已保存记录。</p>
                  ) : (
                    <ul className="reina-sessions">
                      {play.sessions.map((session) => (
                        <li key={session.id} className="reina-session">
                          <span className="reina-session__time">
                            {formatSessionRange(session.startTime, session.endTime)}
                          </span>
                          <span className="reina-session__duration">
                            记录 {formatMinutes(session.recordedMinutes)}
                          </span>
                          <span className="reina-session__meta">
                            来源日期 {formatSourceDate(session.sourceDate)} ·{' '}
                            {trackingModeLabel(session.trackingMode)} ·{' '}
                            {durationPrecisionLabel(session.durationPrecision)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {play.loadMoreError && (
                    <div className="reina-error" role="alert">
                      <span>{play.loadMoreError}</span>
                      <button className="reina-link-button" type="button" onClick={play.loadMore}>
                        重试加载更多
                      </button>
                    </div>
                  )}
                  {play.hasMore && (
                    <button
                      className="button button--ghost button--small"
                      type="button"
                      onClick={play.loadMore}
                      disabled={play.loadingMore}
                    >
                      {play.loadingMore ? (
                        <LoaderCircle className="spin" size={14} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={14} aria-hidden="true" />
                      )}
                      {play.loadingMore ? '正在加载…' : '加载更多会话'}
                    </button>
                  )}
                  {!play.hasMore && play.sessions.length > 0 && (
                    <p className="reina-hint">已加载全部已保存会话。</p>
                  )}
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
