import { useEffect, useId, useRef, useState } from 'react';
import { FolderPlus, LoaderCircle } from 'lucide-react';
import type { ReinaBatchPreview, ReinaBatchRow, ReinaBatchResult } from '../../../../shared/reina';
import { useLibraryStore } from '../../stores/libraryStore';
import { getReinaBridge, hasBridgeMethod, reinaErrorMessage } from './reina-bridge';
import { notifyReinaTagsChanged } from './reina-events';

const PAGE_SIZE = 20;
export function ReinaBatchImportPanel({ sourceId, disabled = false }: { sourceId: string; disabled?: boolean }) {
  const headingId = useId();
  const blockingId = useId();
  const [preview, setPreview] = useState<ReinaBatchPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReinaBatchResult | null>(null);
  const [page, setPage] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{ externalGameId: number } | null>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const bridge = getReinaBridge();
  const supported = bridge && hasBridgeMethod(bridge, 'reinaBatchPreview') && hasBridgeMethod(bridge, 'reinaBatchApply');

  const loadPreview = async () => {
    if (!supported || disabled || busy) return;
    setBusy('preview'); setError(null); setResult(null); setPreview(null);
    try {
      const next = await bridge.reinaBatchPreview(sourceId);
      if (alive.current) { setPreview(next); setPage(0); setFocusRequest(null); }
    } catch (failure) {
      if (alive.current) setError(reinaErrorMessage(failure, '无法读取批量导入预览，请重试。'));
    } finally { if (alive.current) setBusy(null); }
  };
  const updateRow = (externalGameId: number, value: string) => {
    setError(null);
    setPreview(previous => previous && ({ ...previous, rows: previous.rows.map(row => row.externalGameId !== externalGameId ? row : {
      ...row, action: value.startsWith('link:') ? 'link' : value as ReinaBatchRow['action'],
      localGameId: value.startsWith('link:') ? value.slice(5) : undefined,
    }) }));
  };
  const rows = preview?.rows ?? [];
  const counts = { create: rows.filter(row => row.action === 'create').length, link: rows.filter(row => row.action === 'link').length, skip: rows.filter(row => row.action === 'skip').length, review: rows.filter(row => row.action === 'review').length };
  const assigned = rows.filter(row => row.action === 'link').map(row => row.localGameId);
  const targetCounts = new Map<string | undefined, number>();
  for (const id of assigned) targetCounts.set(id, (targetCounts.get(id) ?? 0) + 1);
  const duplicates = assigned.length !== targetCounts.size;
  const issues = rows.filter(row => row.action === 'review' || (row.action === 'link' && (targetCounts.get(row.localGameId) ?? 0) > 1));
  const displayError = error || (duplicates ? '多个来源作品选择了同一本地作品，请调整匹配或新建作品。' : null);
  const locateIssue = (row = issues[0]) => {
    if (!row) return;
    setPage(Math.floor(rows.indexOf(row) / PAGE_SIZE));
    setFocusRequest({ externalGameId: row.externalGameId });
  };
  useEffect(() => {
    if (!focusRequest) return;
    const select = rowsRef.current?.querySelector<HTMLSelectElement>(`select[data-external-game-id="${focusRequest.externalGameId}"]`);
    select?.focus({ preventScroll: true });
    select?.closest('.reina-batch__row')?.scrollIntoView?.({ block: 'nearest' });
  }, [focusRequest]);
  const apply = async () => {
    if (!supported || !preview || disabled || busy) return;
    if (issues.length) {
      setError(duplicates ? '多个来源作品选择了同一本地作品，请调整匹配或新建作品。' : `还有 ${counts.review} 部作品需要手动确认，已定位「${issues[0].name}」。请选择关联已有作品、新建或跳过，再确认导入。`);
      locateIssue(); return;
    }
    if (counts.create + counts.link === 0) {
      setError('请至少选择一部需要新建或关联的作品，再确认导入。'); return;
    }
    setBusy('apply'); setError(null);
    try {
      const imported = await bridge.reinaBatchApply(preview.token, preview.rows.map(({ externalGameId, action, localGameId }) => ({ externalGameId, action, ...(action === 'link' ? { localGameId } : {}) })));
      await useLibraryStore.getState().loadGames();
      notifyReinaTagsChanged();
      if (alive.current) { setResult(imported); setPreview(null); }
    } catch (failure) {
      if (alive.current) setError(reinaErrorMessage(failure, '导入失败，请重新预览后重试。'));
    } finally { if (alive.current) setBusy(null); }
  };
  return (
    <section className="reina-batch" aria-labelledby={headingId} aria-busy={Boolean(busy)}>
      <h4 id={headingId}>批量导入作品</h4>
      <p className="reina-hint">读取全部游戏；已有作品自动匹配，缺少的作品新建文件夹。可以逐项手动匹配或跳过，确认后才保存。</p>
      <button type="button" className="button button--ghost button--small" onClick={() => void loadPreview()} disabled={!supported || disabled || Boolean(busy)}>
        {busy === 'preview' ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <FolderPlus size={14} aria-hidden="true" />}
        {busy === 'preview' ? '正在读取全部作品…' : preview || result ? '重新预览全部作品' : '预览并导入全部作品'}
      </button>
      {!supported && <p className="reina-hint">请重启开发版以加载批量导入接口。</p>}
      {displayError && <p className="reina-error" role="alert">{displayError}</p>}
      {result && <p className="reina-status" role="status">导入完成：新建 {result.created} 部，关联 {result.linked} 部，跳过 {result.skipped} 部。可在作品概览查看来源历史总时长及游玩时段。</p>}
      {preview && <div className="reina-batch__preview">
        <p className="reina-batch__summary" role="status">共 {rows.length} 部 · 新建 {counts.create} · 关联 {counts.link} · 跳过 {counts.skip} · 待确认 {counts.review}</p>
        <p className="reina-hint reina-batch__path">新建文件夹位置：{preview.libraryPath}</p>
        <p className="reina-hint">预览有效期为 5 分钟；来源或本地音乐库变化后需要重新预览。</p>
        {preview.warnings.map((warning, index) => <p className="reina-notice" key={index}>{warning}</p>)}
        {rows.length === 0 ? <p className="reina-empty">来源中没有可导入的作品。</p> : <>
          <div className="reina-batch__rows" ref={rowsRef}>
            {rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row => (
              <div className="reina-batch__row" key={row.externalGameId}>
                <div className="reina-batch__name">
                  <strong>{row.name}</strong><small>来源 #{row.externalGameId} · {row.reason}</small>
                  {row.action === 'create' && <small>新作品名称：{row.newName}</small>}
                </div>
                <label className="reina-batch__choice">
                  <span>导入方式 · {row.name}</span>
                  <select data-external-game-id={row.externalGameId} aria-label={`匹配 ${row.name}（${row.externalGameId}）`} value={row.action === 'link' ? `link:${row.localGameId}` : row.action} onChange={event => updateRow(row.externalGameId, event.target.value)} disabled={Boolean(busy)}>
                    <option value="review" disabled>请选择对应作品</option>
                    {!row.alreadyLinked && <option value="create">新建作品及文件夹</option>}
                    <option value="skip">跳过此作品</option>
                    <optgroup label="关联已有作品">
                      {preview.localGames.filter(local => row.alreadyLinked ? local.id === row.localGameId || local.boundExternalGameId === row.externalGameId : local.boundExternalGameId === undefined).map(local => (
                        <option key={local.id} value={`link:${local.id}`}>{local.name} · #{local.id.slice(0, 8)}</option>
                      ))}
                    </optgroup>
                  </select>
                </label>
              </div>
            ))}
          </div>
          {rows.length > PAGE_SIZE && <nav className="reina-panel__actions" aria-label="导入作品分页">
            <button type="button" className="button button--ghost button--small" disabled={page === 0 || Boolean(busy)} onClick={() => setPage(value => value - 1)}>上一页</button>
            <span>{page + 1} / {Math.ceil(rows.length / PAGE_SIZE)}</span>
            <button type="button" className="button button--ghost button--small" disabled={(page + 1) * PAGE_SIZE >= rows.length || Boolean(busy)} onClick={() => setPage(value => value + 1)}>下一页</button>
          </nav>}
          <p className="reina-hint" id={blockingId}>
            {issues.length ? `有 ${issues.length} 部作品需要检查，可能在其他分页。处理完成后才会保存导入。` : counts.create + counts.link === 0 ? '当前全部作品已跳过，请先选择要导入的作品。' : '匹配检查完成，可以确认导入。'}
          </p>
          {issues.length > 0 && <button type="button" className="button button--ghost button--small" disabled={disabled || Boolean(busy)} onClick={() => {
            const current = issues.findIndex(row => row.externalGameId === focusRequest?.externalGameId);
            locateIssue(issues[(current + 1) % issues.length]);
          }}>处理待确认作品（{issues.length}）</button>}
          <p className="reina-hint">已有音乐和手账会保留。来源记录保持只读，时长通过作品关联读取；不会复制游戏程序或音频。</p>
          <div className="reina-panel__actions">
            <button type="button" className="button button--primary" aria-describedby={blockingId} onClick={() => void apply()} disabled={disabled || Boolean(busy)}>
              {busy === 'apply' && <LoaderCircle className="spin" size={14} aria-hidden="true" />}
              {busy === 'apply' ? '正在导入，请稍候…' : `确认导入 ${counts.create + counts.link} 部作品`}
            </button>
            <button type="button" className="button button--ghost" disabled={Boolean(busy)} onClick={() => { setPreview(null); setError(null); }}>取消</button>
          </div>
        </>}
      </div>}
    </section>
  );
}
