import {
  ArrowDownToLine, ArrowUpToLine, BookOpen, Check, ChevronLeft, ChevronRight,
  Copy, Download, GripHorizontal, ImagePlus, Lock, Maximize2, Minus, Music2,
  Play, Plus, Quote, Redo2, RotateCw, Save, Scan, SlidersHorizontal,
  Sparkles, Trash2, Type, Undo2, Unlock, Video, X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

import { toCoverUrl } from '../../../../shared/cover-url';
import type { Game, JournalAsset, JournalBlock, JournalPage, JournalPageCreate, Track } from '../../../../shared/types';
import type { ReinaPlaySnapshot } from '../../../../shared/reina';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useJournalHistory } from './useJournalHistory';
import { useJournalMotion } from './useJournalMotion';
import {
  addJournalBlock, createBlankJournalPage, createJournalMediaBlock,
  createJournalPlaySessionBlock, createJournalQuoteBlock, createJournalTextBlock,
  createJournalTrackBlock, duplicateJournalBlock, expandJournalCanvas,
  moveJournalBlock, removeJournalBlock, resizeJournalBlock, rotateJournalBlock,
  setJournalBlockZIndex, updateJournalBackground, updateJournalBlock,
} from './journal-model';
import { downloadJournalPagePng, downloadJournalPageSvg } from './journal-export';
import { describePlaySnapshot, formatPlayMinutes } from './journal-play-session';
import { JournalBlockBody } from './JournalBlockBody';
import { PlaySessionPicker } from './PlaySessionPicker';
import { saveJournalSession, waitForJournalSaves, type JournalSaveSession } from './journal-persistence';
import './journal-workspace.css';

export interface JournalWorkspaceProps {
  game: Game;
  tracks: Track[];
  currentTrack?: Track | null;
  currentTime?: number;
  onPlayTrack(track: Track): void;
  onSeekTo(seconds: number): void;
}

type Interaction = {
  kind: 'move' | 'resize'; blockId: string; pointerId: number;
  startX: number; startY: number; page: JournalPage;
};

const blockLabels: Record<JournalBlock['type'], string> = {
  text: '便签', quote: '引用', image: '图片', video: '视频', track: '音乐',
  'play-session': '游玩记录', details: '作品详情',
};
const getApi = () => window.galMusic;
const id = () => globalThis.crypto?.randomUUID?.() ?? `journal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function defaultPageInput(gameId: string, pageId: string, title: string): JournalPageCreate {
  const page = createBlankJournalPage(gameId, pageId, title);
  return {
    id: page.id, gameId: page.gameId, title: page.title,
    canvasWidth: page.canvasWidth, canvasHeight: page.canvasHeight,
    background: page.background, blocks: [createJournalTextBlock(id(), 64, 150)],
    tags: ['初见'], soundtrackTrackId: null,
  };
}

function memoryValue(block: JournalBlock, tracks: Track[], assets: JournalAsset[]): string {
  if (block.type === 'text') return block.text || '空白便签';
  if (block.type === 'quote') return `${block.quote}${block.attribution ? `\n—— ${block.attribution}` : ''}`;
  if (block.type === 'track') return tracks.find(track => track.id === block.trackId)?.displayName ?? '未找到曲目';
  if (block.type === 'image' || block.type === 'video') return block.caption || assets.find(asset => asset.id === block.assetId)?.fileName || '素材';
  if (block.type === 'play-session') return describePlaySnapshot(block.snapshot);
  return '';
}

function JournalMemoryDialog({ game, pages, initialIndex, tracks, assets, onClose, onPlayTrack }: {
  game: Game; pages: JournalPage[]; initialIndex: number; tracks: Track[]; assets: JournalAsset[];
  onClose(): void; onPlayTrack(track: Track): void;
}) {
  const [index, setIndex] = useState(Math.max(0, initialIndex));
  const ref = useDialogFocus(onClose);
  const page = pages[index];
  const soundtrack = tracks.find(track => track.id === page.soundtrackTrackId);
  return (
    <div className="journal-memory-overlay" onMouseDown={onClose}>
      <section ref={ref} className="journal-memory-dialog" role="dialog" aria-modal="true" aria-label="记忆模式" tabIndex={-1} onMouseDown={event => event.stopPropagation()}>
        <div className="journal-memory-dialog__topline"><span><BookOpen size={16} />记忆模式 <small>{index + 1} / {pages.length}</small></span><button type="button" className="journal-icon" aria-label="关闭记忆模式" onClick={onClose}><X size={18} /></button></div>
        <div key={page.id} className={`journal-memory-page journal-memory-page--${page.background.pattern}`} style={{ backgroundColor: page.background.color }}>
          <span className="journal-memory-page__game">{game.name}</span><h3>{page.title || '未命名页面'}</h3>
          <div className="journal-memory-page__blocks">
            {page.blocks.filter(block => block.type !== 'details').slice().sort((a, b) => a.zIndex - b.zIndex).map(block => (
              <div key={block.id} className="journal-memory-page__block"><strong>{blockLabels[block.type]}</strong><span>{memoryValue(block, tracks, assets)}</span></div>
            ))}
            {page.blocks.length === 0 && <p>这一页，等待下一段故事。</p>}
          </div>
        </div>
        <div className="journal-memory-dialog__footer">
          <button className="journal-button" type="button" onClick={() => setIndex(value => value - 1)} disabled={index === 0}><ChevronLeft size={16} />上一页</button>
          <button className="journal-button" type="button" onClick={() => soundtrack && onPlayTrack(soundtrack)} disabled={!soundtrack}><Play size={15} />播放页面 BGM</button>
          <button className="journal-button" type="button" onClick={() => setIndex(value => value + 1)} disabled={index >= pages.length - 1}>下一页<ChevronRight size={16} /></button>
        </div>
      </section>
    </div>
  );
}

export function JournalWorkspace({ game, tracks, currentTrack, currentTime = 0, onPlayTrack, onSeekTo }: JournalWorkspaceProps) {
  const [pages, setPages] = useState<JournalPage[]>([]);
  const [assets, setAssets] = useState<JournalAsset[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [memoryMode, setMemoryMode] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [zoom, setZoom] = useState(0.9);
  const [zoomMode, setZoomMode] = useState<'edit' | 'fit' | 'manual'>('edit');
  const [trackForBlock, setTrackForBlock] = useState(currentTrack?.id ?? tracks[0]?.id ?? '');
  const [interactionDraft, setInteractionDraft] = useState<JournalPage | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const interactionDraftRef = useRef<JournalPage | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const inspectorToggleRef = useRef<HTMLButtonElement>(null);
  const sessionRef = useRef<JournalSaveSession | null>(null);
  const leaveRef = useRef<() => void>(() => {});
  const pendingTabFocusRef = useRef<string | null>(null);
  const navigatingRef = useRef(false);
  const generationRef = useRef(0);
  const activePage = pages.find(item => item.id === activePageId) ?? null;
  const history = useJournalHistory(activePage);
  const { commit, replace, undo, redo } = history;
  const currentPage = activePage && history.page.id !== activePage.id ? activePage : history.page;
  const pageRef = useRef(currentPage);
  pageRef.current = currentPage;
  if (sessionRef.current?.page.id === currentPage.id) sessionRef.current.page = currentPage;
  const page = interactionDraft ?? currentPage;
  const selectedBlock = page.blocks.find(block => block.id === selectedBlockId) ?? null;
  const activeIndex = pages.findIndex(item => item.id === activePageId);
  const coverUrl = game.coverPath ? toCoverUrl(game.coverPath) : undefined;

  useJournalMotion(stageRef, inspectorRef, page.id, page.blocks.map(block => block.id), inspectorOpen);

  useEffect(() => { setTrackForBlock(currentTrack?.id ?? tracks[0]?.id ?? ''); }, [currentTrack?.id, tracks]);

  const loadWorkspace = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoading(true); setLoadError(null); setNotice(null);
    navigatingRef.current = false; setBusy(false); pendingTabFocusRef.current = null;
    try {
      const unsaved = await waitForJournalSaves(game.id);
      if (generation !== generationRef.current) return;
      const api = getApi();
      const [loadedPages, loadedAssets] = await Promise.all([
        api?.getJournalPages?.(game.id) ?? [], api?.getJournalAssets?.(game.id) ?? [],
      ]);
      if (generation !== generationRef.current) return;
      let nextPages: JournalPage[] = loadedPages.map(item => ({ ...item, blocks: item.blocks.filter(block => block.type !== 'details') }));
      if (!nextPages.length) {
        const input = defaultPageInput(game.id, id(), '初见 · 作品手账');
        const created = api?.createJournalPage ? await api.createJournalPage(input) : { ...createBlankJournalPage(game.id, input.id, input.title), ...input };
        nextPages = [created];
      }
      if (generation !== generationRef.current) return;
      const recovered = unsaved && nextPages.some(item => item.id === unsaved.page.id) ? unsaved : undefined;
      if (recovered) nextPages = nextPages.map(item => item.id === recovered.page.id ? recovered.page : item);
      sessionRef.current = recovered ?? { page: nextPages[0], dirty: false, revisions: new Map(nextPages.map(item => [item.id, item.revision])), job: null };
      setPages(nextPages); setAssets(loadedAssets); setActivePageId(recovered?.page.id ?? nextPages[0].id);
      setDirty(Boolean(recovered)); setSaving(false); setSaveError(recovered ? '上次离开时未能保存，已恢复编辑，请重试。' : null); setSelectedBlockId(null);
      setInteractionDraft(null); interactionRef.current = null; interactionDraftRef.current = null;
    } catch (error) {
      if (generation === generationRef.current) setLoadError(errorMessage(error));
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [game.id]);

  useEffect(() => {
    void loadWorkspace();
    return () => { leaveRef.current(); generationRef.current += 1; };
  }, [loadWorkspace]);

  const editPage = useCallback((next: JournalPage, keepHistory = true) => {
    pageRef.current = next;
    if (sessionRef.current) { sessionRef.current.page = next; sessionRef.current.dirty = true; }
    if (keepHistory) commit(next); else replace(next);
    setDirty(true); setSaveError(null); setNotice(null);
  }, [commit, replace]);

  // One serial save stream: an older response must never replace newer typing.
  const savePage = useCallback((): Promise<boolean> => {
    const session = sessionRef.current;
    if (!session?.dirty) return Promise.resolve(true);
    if (session.job) return session.job;
    const generation = generationRef.current;
    setSaving(true); setSaveError(null);
    const job = saveJournalSession(session, async draft => {
      const api = getApi();
      if (!api?.saveJournalPage) throw new Error('暂时无法保存手账，请重试。');
      return api.saveJournalPage(draft);
    }, saved => {
      if (generation !== generationRef.current) return;
      setPages(items => items.map(item => item.id === saved.id ? saved : item));
      pageRef.current = session.page; replace(session.page); setDirty(session.dirty);
    }, error => {
      if (generation === generationRef.current) setSaveError(errorMessage(error));
    });
    void job.finally(() => { if (generation === generationRef.current) setSaving(false); });
    return job;
  }, [replace]);
  leaveRef.current = () => { void savePage(); };

  useEffect(() => {
    if (!dirty || !currentPage.id) return;
    const timer = window.setTimeout(() => { void savePage(); }, 900);
    return () => window.clearTimeout(timer);
  }, [dirty, currentPage, savePage]);

  const switchPage = async (targetId: string, focusTab = false) => {
    if (targetId === activePageId || navigatingRef.current || busy) return;
    navigatingRef.current = true; setBusy(true);
    const generation = generationRef.current;
    const saved = await savePage();
    if (generation !== generationRef.current) return;
    if (saved) {
      setActivePageId(targetId); setSelectedBlockId(null); setNotice(null);
      if (sessionRef.current) sessionRef.current.page = pages.find(item => item.id === targetId)!;
      setInteractionDraft(null); interactionRef.current = null; interactionDraftRef.current = null;
      if (focusTab) pendingTabFocusRef.current = targetId;
    }
    navigatingRef.current = false; setBusy(false);
  };

  useLayoutEffect(() => {
    if (busy || pendingTabFocusRef.current !== activePageId) return;
    document.getElementById(`journal-tab-${activePageId}`)?.focus();
    pendingTabFocusRef.current = null;
  }, [activePageId, busy]);

  const createPage = async () => {
    if (navigatingRef.current) return;
    const generation = generationRef.current;
    navigatingRef.current = true; setBusy(true);
    try {
      if (!await savePage()) return;
      if (generation !== generationRef.current) return;
      const input = defaultPageInput(game.id, id(), `第 ${pages.length + 1} 页`);
      const api = getApi();
      const next = api?.createJournalPage ? await api.createJournalPage(input) : { ...createBlankJournalPage(game.id, input.id, input.title), ...input };
      if (generation !== generationRef.current) return;
      setPages(items => [...items, next]);
      // Creating a page can take time; keep anything typed on the old page meanwhile.
      if (!await savePage() || generation !== generationRef.current) return;
      if (sessionRef.current) sessionRef.current.page = next;
      setActivePageId(next.id); setSelectedBlockId(null);
    } catch (error) { if (generation === generationRef.current) setNotice(errorMessage(error)); }
    finally { if (generation === generationRef.current) { navigatingRef.current = false; setBusy(false); } }
  };

  const deletePage = async () => {
    if (!activePage || pages.length <= 1 || busy || !window.confirm(`删除“${page.title}”？`)) return;
    const generation = generationRef.current;
    setBusy(true);
    try {
      // Finish any in-flight write before deleting its page.
      if (sessionRef.current?.job) await sessionRef.current.job;
      if (generation !== generationRef.current) return;
      await getApi()?.deleteJournalPage?.(activePage.id);
      if (generation !== generationRef.current) return;
      const remaining = pages.filter(item => item.id !== activePage.id);
      const next = remaining[Math.min(activeIndex, remaining.length - 1)];
      if (sessionRef.current) { sessionRef.current.dirty = false; sessionRef.current.page = next; }
      setDirty(false); setSaveError(null);
      setPages(remaining); setActivePageId(next.id); setSelectedBlockId(null);
    } catch (error) { if (generation === generationRef.current) setNotice(errorMessage(error)); }
    finally { if (generation === generationRef.current) setBusy(false); }
  };

  const fitCanvas = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !viewport.clientWidth || !viewport.clientHeight) return;
    const widthFit = (viewport.clientWidth - 64) / currentPage.canvasWidth;
    const fullFit = Math.min(widthFit, (viewport.clientHeight - 64) / currentPage.canvasHeight);
    setZoom(Math.max(0.15, Math.min(1, zoomMode === 'fit' ? fullFit : Math.max(0.75, widthFit))));
    viewport.scrollTo?.({ left: 0, top: 0 });
  }, [currentPage.canvasWidth, currentPage.canvasHeight, zoomMode]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const workspace = viewport?.closest<HTMLElement>('.journal-workspace');
    if (!viewport || !workspace) return;
    let frame = 0;
    const measure = () => {
      const headerHeight = viewport.getBoundingClientRect().top - workspace.getBoundingClientRect().top;
      const height = `${Math.round(Math.max(240, Math.min(800, window.innerHeight - headerHeight - 132)))}px`;
      if (workspace.style.getPropertyValue('--journal-viewport-height') !== height) workspace.style.setProperty('--journal-viewport-height', height);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    observer?.observe(workspace);
    window.addEventListener('resize', schedule);
    return () => { observer?.disconnect(); window.removeEventListener('resize', schedule); cancelAnimationFrame(frame); };
  }, [loading, loadError, currentPage.id]);

  useLayoutEffect(() => {
    if (zoomMode === 'manual' || loading) return;
    fitCanvas();
    if (typeof ResizeObserver === 'undefined' || !viewportRef.current) return;
    const observer = new ResizeObserver(fitCanvas);
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [zoomMode, fitCanvas, inspectorOpen, loading]);

  const addBlock = (block: JournalBlock) => {
    editPage(addJournalBlock(pageRef.current, block)); setSelectedBlockId(block.id);
    setNotice(`已添加${blockLabels[block.type]} · 拖动顶部手柄调整位置`);
  };

  const addMedia = async (kind: 'image' | 'video') => {
    const api = getApi();
    if (!api?.selectJournalMedia) { setNotice('当前环境暂不支持素材导入'); return; }
    const pageId = page.id;
    const generation = generationRef.current;
    setBusy(true);
    try {
      const imported = await api.selectJournalMedia(game.id, kind);
      if (generation !== generationRef.current) return;
      setAssets(items => [...new Map([...items, ...imported].map(asset => [asset.id, asset])).values()]);
      if (pageRef.current.id !== pageId) return;
      let next = pageRef.current;
      imported.forEach((asset, index) => { next = addJournalBlock(next, createJournalMediaBlock(id(), kind, asset.id, 80 + index % 3 * 40, 150 + index % 2 * 40)); });
      if (imported.length) { editPage(next); setSelectedBlockId(next.blocks.at(-1)?.id ?? null); setNotice(`已导入 ${imported.length} 个${kind === 'image' ? '图片' : '视频'}素材`); }
    } catch (error) { if (generation === generationRef.current) setNotice(errorMessage(error)); }
    finally { if (generation === generationRef.current) setBusy(false); }
  };

  const addTrack = () => {
    const track = tracks.find(item => item.id === trackForBlock) ?? currentTrack ?? tracks[0];
    if (!track) { setNotice('当前作品还没有曲目'); return; }
    addBlock(createJournalTrackBlock(id(), track.id, currentTrack?.id === track.id ? currentTime : null, 120, 360));
  };

  const insertPlaySessionCard = (snapshot: ReinaPlaySnapshot) => {
    addBlock(createJournalPlaySessionBlock(id(), snapshot, 96, 300));
    setNotice(`已插入游玩记录 · ${snapshot.externalGameName} · ${formatPlayMinutes(snapshot.stats.sessionTotalMinutes)}`);
  };

  const mutateBlock = (blockId: string, patch: Partial<JournalBlock>) => editPage(updateJournalBlock(pageRef.current, blockId, patch));
  const deleteBlock = () => {
    if (!selectedBlock || selectedBlock.locked) return;
    editPage(removeJournalBlock(pageRef.current, selectedBlock.id)); setSelectedBlockId(null);
  };
  const duplicateBlock = () => {
    if (!selectedBlock) return;
    const copiedId = id(); editPage(duplicateJournalBlock(pageRef.current, selectedBlock.id, copiedId)); setSelectedBlockId(copiedId);
  };
  const closeInspector = () => { setInspectorOpen(false); inspectorToggleRef.current?.focus(); };

  const beginInteraction = (event: PointerEvent, block: JournalBlock, kind: Interaction['kind']) => {
    event.stopPropagation();
    if (event.button !== 0 || event.isPrimary === false || interactionRef.current) return;
    setSelectedBlockId(block.id);
    const target = event.target as HTMLElement;
    if (block.locked || (target.closest('textarea, input, select, button, a, video') && !target.closest('[data-journal-handle]'))) return;
    event.preventDefault();
    const card = event.currentTarget.closest('[data-journal-block]');
    const handle = (target.closest('[data-journal-handle]') ?? card?.querySelector('[data-journal-handle="move"]')) as HTMLElement | null;
    handle?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    interactionRef.current = { kind, blockId: block.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, page: pageRef.current };
  };

  const moveInteraction = (event: PointerEvent) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const dx = (event.clientX - interaction.startX) / zoom;
    const dy = (event.clientY - interaction.startY) / zoom;
    if (!interactionDraftRef.current && Math.hypot(dx, dy) < 3) return;
    const block = interaction.page.blocks.find(item => item.id === interaction.blockId);
    if (!block) return;
    const angle = block.rotation * Math.PI / 180;
    const next = interaction.kind === 'move'
      ? moveJournalBlock(interaction.page, block.id, dx, dy)
      : resizeJournalBlock(interaction.page, block.id, block.width + dx * Math.cos(angle) + dy * Math.sin(angle), block.height - dx * Math.sin(angle) + dy * Math.cos(angle));
    interactionDraftRef.current = next; setInteractionDraft(next);
  };

  const finishInteraction = (event: PointerEvent, cancelled = false) => {
    if (!interactionRef.current || interactionRef.current.pointerId !== event.pointerId) return;
    const draft = interactionDraftRef.current;
    interactionRef.current = null; interactionDraftRef.current = null; setInteractionDraft(null);
    if (draft && !cancelled) editPage(draft);
  };

  const handleKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (memoryMode || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    const editing = Boolean(target.closest('textarea, input, select, [contenteditable="true"]'));
    const modified = event.ctrlKey || event.metaKey;
    if (modified && event.key.toLowerCase() === 's') { event.preventDefault(); void savePage(); return; }
    if (editing || busy) return;
    if (modified && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey ? history.canRedo : history.canUndo) {
        if (event.shiftKey) redo(); else undo(); if (sessionRef.current) sessionRef.current.dirty = true; setDirty(true); setSaveError(null);
      }
    } else if (modified && event.key.toLowerCase() === 'd' && selectedBlock) {
      event.preventDefault(); duplicateBlock();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedBlock) {
      event.preventDefault(); deleteBlock();
    } else if (event.key === 'Escape') {
      if (interactionRef.current) { interactionRef.current = null; interactionDraftRef.current = null; setInteractionDraft(null); }
      else if (inspectorOpen && inspectorRef.current?.contains(target)) closeInspector();
      else setSelectedBlockId(null);
    } else if (selectedBlock && !selectedBlock.locked && target.closest('[data-journal-block]') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); const step = event.shiftKey ? 10 : 1;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      editPage(moveJournalBlock(pageRef.current, selectedBlock.id, dx, dy));
    }
  };

  const tabKeyboard = (event: KeyboardEvent, index: number) => {
    const targetIndex = event.key === 'ArrowLeft' ? (index - 1 + pages.length) % pages.length : event.key === 'ArrowRight' ? (index + 1) % pages.length : event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : -1;
    if (targetIndex < 0) return;
    event.preventDefault(); void switchPage(pages[targetIndex].id, true);
  };

  const exportPage = async (kind: 'png' | 'svg') => {
    try {
      const options = { gameName: game.name, tracks, assets, coverUrl };
      if (kind === 'png') await downloadJournalPagePng(page, options); else downloadJournalPageSvg(page, options);
    } catch (error) { setNotice(`导出失败：${errorMessage(error)}`); }
  };

  if (loading) return <section className="journal-workspace journal-workspace--loading" aria-live="polite"><BookOpen size={30} /><strong>正在翻开手账</strong><span>把喜欢的瞬间，留在这里。</span><span className="loading-state__spinner" /></section>;
  if (loadError || !page.id) return <section className="journal-workspace journal-workspace--loading" role="alert"><BookOpen size={30} /><strong>这一页暂时没有打开</strong><p>{loadError}</p><button type="button" className="journal-button journal-button--accent" onClick={() => void loadWorkspace()}>重新打开</button></section>;

  return (
    <section className="journal-workspace" aria-label="作品手账" onKeyDown={handleKeyboard}>
      <header className="journal-workspace__topline">
        <div className="journal-workspace__identity"><div className="journal-workspace__eyebrow"><BookOpen size={15} />作品手账<span>{String(pages.length).padStart(2, '0')} PAGES</span></div><h2 title={game.name}>{game.name}</h2></div>
        <div className="journal-workspace__actions">
          <span className={`journal-save-status${dirty ? ' is-dirty' : ''}${saveError ? ' is-error' : ''}`} role="status">{saving ? <span className="loading-state__spinner" /> : dirty ? <span className="journal-status-dot" /> : <Check size={14} />}{saving ? '保存中' : saveError ? '保存失败' : dirty ? '等待保存' : '已保存到本地'}</span>
          <details className="journal-export-menu"><summary className="journal-button"><Download size={15} /><span>导出</span></summary><div><button type="button" onClick={() => void exportPage('png')}>导出 PNG</button><button type="button" onClick={() => void exportPage('svg')}>导出 SVG</button></div></details>
          <button className="journal-button" type="button" onClick={() => setMemoryMode(true)}><BookOpen size={15} />记忆模式</button>
          <button className="journal-button journal-button--accent" type="button" onClick={() => void savePage()} disabled={saving || !dirty} title="保存 · Ctrl / ⌘ S"><Save size={15} /><span>保存</span></button>
        </div>
      </header>

      {saveError && <div className="journal-alert" role="alert"><span>未能保存：{saveError}。当前编辑已保留，请重试。</span><button type="button" className="journal-button" onClick={() => void savePage()} disabled={saving}>重试保存</button></div>}

      <nav className="journal-page-tabs" aria-label="页面导航">
        <div className="journal-page-tabs__list" role="tablist" aria-label="手账页面">
          {pages.map((item, index) => <button key={item.id} id={`journal-tab-${item.id}`} role="tab" type="button" className={`journal-page-tab${item.id === activePageId ? ' is-active' : ''}`} aria-selected={item.id === activePageId} aria-controls={`journal-page-${item.id}`} tabIndex={item.id === activePageId ? 0 : -1} disabled={busy} title={item.title} onClick={() => void switchPage(item.id)} onKeyDown={event => tabKeyboard(event, index)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.title || '未命名页面'}</strong>{item.id === activePageId && <span className="journal-page-tab__dot" />}</button>)}
        </div>
        <button className="journal-page-tabs__new" type="button" onClick={() => void createPage()} disabled={busy}><Plus size={16} /><span>新页面</span></button>
      </nav>

      <div className={`journal-workspace__body${inspectorOpen ? ' has-inspector' : ''}`}>
        <div className="journal-editor" role="tabpanel" id={`journal-page-${page.id}`} aria-labelledby={`journal-tab-${page.id}`}>
          <div className="journal-editor__toolbar">
            <div className="journal-insert-tools" role="group" aria-label="添加到手账">
              <span className="journal-toolbar-label">添加</span>
              <button type="button" aria-label="便签" onClick={() => addBlock(createJournalTextBlock(id(), 64, 150))}><Type size={17} /><span>便签</span></button>
              <button type="button" aria-label="引用" onClick={() => addBlock(createJournalQuoteBlock(id(), 340, 170))}><Quote size={17} /><span>引用</span></button>
              <button type="button" aria-label="图片" onClick={() => void addMedia('image')} disabled={busy}><ImagePlus size={17} /><span>图片</span></button>
              <button type="button" aria-label="视频" onClick={() => void addMedia('video')} disabled={busy}><Video size={17} /><span>视频</span></button>
              <button type="button" aria-label="音乐" onClick={addTrack} disabled={!tracks.length}><Music2 size={17} /><span>音乐</span></button>
            </div>
            <div className="journal-editor__toolbar-end">
              <button type="button" className="journal-icon" aria-label="撤销" title="撤销 · Ctrl / ⌘ Z" onClick={() => { undo(); if (sessionRef.current) sessionRef.current.dirty = true; setDirty(true); }} disabled={!history.canUndo}><Undo2 size={17} /></button>
              <button type="button" className="journal-icon" aria-label="重做" title="重做 · Ctrl / ⌘ Shift Z" onClick={() => { redo(); if (sessionRef.current) sessionRef.current.dirty = true; setDirty(true); }} disabled={!history.canRedo}><Redo2 size={17} /></button>
              <span className="journal-editor__divider" />
              <button ref={inspectorToggleRef} type="button" className={`journal-button journal-inspector-toggle${inspectorOpen ? ' is-active' : ''}`} aria-label="切换属性面板" aria-expanded={inspectorOpen} aria-controls="journal-inspector" onClick={() => setInspectorOpen(value => !value)}><SlidersHorizontal size={16} /><span>属性</span></button>
            </div>
          </div>

          <div className={`journal-canvas-viewport${interactionDraft ? ' is-interacting' : ''}`} ref={viewportRef} onPointerMove={moveInteraction} onPointerUp={event => finishInteraction(event)} onPointerCancel={event => finishInteraction(event, true)}>
            <div className="journal-canvas-sizer" style={{ width: page.canvasWidth * zoom, height: page.canvasHeight * zoom }}>
              <div className="journal-canvas-stage" ref={stageRef}>
                <div className={`journal-canvas journal-canvas--${page.background.pattern}`} style={{ '--journal-zoom': zoom, width: page.canvasWidth, height: page.canvasHeight, transform: `scale(${zoom})`, backgroundColor: page.background.color } as CSSProperties} onPointerDown={event => { if (event.target === event.currentTarget) setSelectedBlockId(null); }}>
                  <div className="journal-canvas__header"><span className="journal-canvas__eyebrow">{String(activeIndex + 1).padStart(2, '0')} / MY MEMORIES</span><input className="journal-canvas__title" value={page.title} onChange={event => editPage({ ...pageRef.current, title: event.target.value }, false)} aria-label="手账页面标题" /><span className="journal-canvas__game">{game.name}</span></div>
                  {!page.blocks.length && <div className="journal-canvas__empty"><span><Sparkles size={28} /></span><h3>故事，从这一页开始</h3><p>一段话、一张照片，或是一首难忘的歌。</p><button type="button" onClick={() => addBlock(createJournalTextBlock(id(), 96, 160))}><Plus size={17} />写下第一张便签</button></div>}
                  {page.blocks.slice().sort((a, b) => a.zIndex - b.zIndex).map(block => {
                    const asset = block.type === 'image' || block.type === 'video' ? assets.find(item => item.id === block.assetId) : undefined;
                    const track = block.type === 'track' ? tracks.find(item => item.id === block.trackId) : undefined;
                    const selected = block.id === selectedBlockId;
                    return <div key={block.id} data-journal-block={block.id} className={`journal-block journal-block--${block.type}${selected ? ' is-selected' : ''}${block.locked ? ' is-locked' : ''}`} style={{ left: block.x, top: block.y, width: block.width, height: block.height, zIndex: block.zIndex, transform: `rotate(${block.rotation}deg)` }} onPointerDown={event => beginInteraction(event, block, 'move')} onFocus={() => setSelectedBlockId(block.id)}>
                      <div className="journal-block__surface"><JournalBlockBody block={block} asset={asset} track={track} onTextChange={(blockId, text) => mutateBlock(blockId, { text })} onQuoteChange={(blockId, field, value) => mutateBlock(blockId, { [field]: value })} onCaptionChange={(blockId, caption) => mutateBlock(blockId, { caption })} onTrackNoteChange={(blockId, note) => mutateBlock(blockId, { note })} onPlayTrack={onPlayTrack} onSeekTo={onSeekTo} /></div>
                      <button className="journal-block__move-handle" type="button" data-journal-handle="move" aria-label={`移动${blockLabels[block.type]}`} title="拖动移动 · 方向键微调 · Shift 加速" onPointerDown={event => beginInteraction(event, block, 'move')} disabled={block.locked}><GripHorizontal size={17} /><span>{blockLabels[block.type]}</span></button>
                      {selected && <><div className="journal-block__selection-label">{block.locked ? <Lock size={12} /> : <span />}{block.locked ? '已锁定' : `${Math.round(block.width)} × ${Math.round(block.height)}`}</div>{!block.locked && <button type="button" className="journal-block__resize-handle" data-journal-handle="resize" aria-label="调整大小" title="拖动调整大小" onPointerDown={event => beginInteraction(event, block, 'resize')} />}</>}
                    </div>;
                  })}
                </div>
              </div>
            </div>
          </div>

          <footer className="journal-editor__footer">
            <span className="journal-editor__hint" role="status">{notice ?? (selectedBlock ? `${blockLabels[selectedBlock.type]}已选中 · 拖动手柄移动，方向键微调` : '自由排版，让每一段记忆都有自己的位置。')}</span>
            <div className="journal-zoom-controls"><button type="button" className="journal-icon" aria-label="缩小画布" onClick={() => { setZoomMode('manual'); setZoom(value => Math.max(0.15, value - 0.1)); }} disabled={zoom <= 0.15}><Minus size={15} /></button><output aria-label="画布缩放">{Math.round(zoom * 100)}%</output><button type="button" className="journal-icon" aria-label="放大画布" onClick={() => { setZoomMode('manual'); setZoom(value => Math.min(1.5, value + 0.1)); }} disabled={zoom >= 1.5}><Plus size={15} /></button><button type="button" className="journal-icon" aria-label="适应窗口" title="适应窗口" onClick={() => { if (zoomMode === 'fit') fitCanvas(); else setZoomMode('fit'); }}><Scan size={16} /></button></div>
          </footer>
        </div>

        {inspectorOpen && <aside ref={inspectorRef} id="journal-inspector" className="journal-inspector" aria-label="页面与对象" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); closeInspector(); } }}>
          <div className="journal-inspector__heading"><div><span>{selectedBlock ? '对象属性' : '纸面与声音'}</span><h3>{selectedBlock ? blockLabels[selectedBlock.type] : '页面设置'}</h3></div><button type="button" className="journal-icon" aria-label="关闭属性面板" onClick={closeInspector}><X size={17} /></button></div>
          {selectedBlock ? <div className="journal-inspector__section">
            <div className="journal-inspector__section-heading"><span>位置与尺寸</span><button className="journal-icon" type="button" aria-label={selectedBlock.locked ? '解锁对象' : '锁定对象'} onClick={() => mutateBlock(selectedBlock.id, { locked: !selectedBlock.locked })}>{selectedBlock.locked ? <Lock size={15} /> : <Unlock size={15} />}</button></div>
            <fieldset disabled={selectedBlock.locked}><div className="journal-inspector__metrics">
              <label>X<input type="number" value={Math.round(selectedBlock.x)} onChange={event => editPage(moveJournalBlock(page, selectedBlock.id, Number(event.target.value) - selectedBlock.x, 0))} /></label>
              <label>Y<input type="number" value={Math.round(selectedBlock.y)} onChange={event => editPage(moveJournalBlock(page, selectedBlock.id, 0, Number(event.target.value) - selectedBlock.y))} /></label>
              <label>宽<input type="number" min={40} value={Math.round(selectedBlock.width)} onChange={event => editPage(resizeJournalBlock(page, selectedBlock.id, Number(event.target.value), selectedBlock.height))} /></label>
              <label>高<input type="number" min={40} value={Math.round(selectedBlock.height)} onChange={event => editPage(resizeJournalBlock(page, selectedBlock.id, selectedBlock.width, Number(event.target.value)))} /></label>
            </div>
            {selectedBlock.type === 'text' && <div className="journal-inspector__style-grid"><label>便签颜色<input type="color" value={selectedBlock.backgroundColor} onChange={event => mutateBlock(selectedBlock.id, { backgroundColor: event.target.value })} /></label><label>文字颜色<input type="color" value={selectedBlock.color} onChange={event => mutateBlock(selectedBlock.id, { color: event.target.value })} /></label><label>字号<input type="number" min={12} max={72} value={selectedBlock.fontSize} onChange={event => mutateBlock(selectedBlock.id, { fontSize: Math.min(72, Math.max(12, Number(event.target.value))) })} /></label></div>}
            <div className="journal-inspector__actions"><button type="button" className="journal-button" onClick={() => editPage(rotateJournalBlock(page, selectedBlock.id, -5))}><RotateCw size={14} className="is-flipped" />左转</button><button type="button" className="journal-button" onClick={() => editPage(rotateJournalBlock(page, selectedBlock.id, 5))}><RotateCw size={14} />右转</button></div>
            <div className="journal-inspector__actions"><button type="button" className="journal-button" onClick={() => editPage(setJournalBlockZIndex(page, selectedBlock.id, Math.max(...page.blocks.map(block => block.zIndex), 0) + 1))}><ArrowUpToLine size={14} />置顶</button><button type="button" className="journal-button" onClick={() => editPage(setJournalBlockZIndex(page, selectedBlock.id, Math.min(...page.blocks.map(block => block.zIndex), 0) - 1))}><ArrowDownToLine size={14} />置底</button></div>
            </fieldset>
            <div className="journal-inspector__actions"><button type="button" className="journal-button" onClick={duplicateBlock}><Copy size={14} />复制</button><button type="button" className="journal-button journal-button--danger" disabled={selectedBlock.locked} onClick={deleteBlock}><Trash2 size={14} />删除</button></div>
            <button type="button" className="journal-inspector__back" onClick={() => setSelectedBlockId(null)}><ChevronLeft size={14} />返回页面设置</button>
          </div> : <div className="journal-inspector__section journal-inspector__page">
            <label>页面标题<input value={page.title} onChange={event => editPage({ ...page, title: event.target.value }, false)} /></label>
            <label>标签<span className="journal-inspector__label-hint">逗号分隔</span><input value={page.tags.join('，')} placeholder="初见，夏日，通关" onChange={event => editPage({ ...page, tags: event.target.value.split(/[，,]/).map(tag => tag.trim()).filter(Boolean).slice(0, 30) }, false)} /></label>
            <label>纸张颜色<input type="color" value={page.background.color} onChange={event => editPage(updateJournalBackground(page, { color: event.target.value }))} /></label>
            <label>纸纹<select value={page.background.pattern} onChange={event => editPage(updateJournalBackground(page, { pattern: event.target.value as JournalPage['background']['pattern'] }))}><option value="paper">横线纸</option><option value="plain">纯色</option><option value="grid">方格纸</option><option value="dots">点阵纸</option></select></label>
            <div className="journal-inspector__section-heading"><span>画布大小</span><small>{page.canvasWidth} × {page.canvasHeight}</small></div>
            <div className="journal-inspector__actions"><button type="button" className="journal-button" onClick={() => editPage(expandJournalCanvas(page, 'width'))}><Maximize2 size={13} />扩展横向</button><button type="button" className="journal-button" onClick={() => editPage(expandJournalCanvas(page, 'height'))}><Maximize2 size={13} className="is-rotated-90" />扩展纵向</button></div>
            <button type="button" className="journal-button journal-button--danger" onClick={() => void deletePage()} disabled={busy || pages.length <= 1}><Trash2 size={14} />删除页面</button>
          </div>}
          <div className="journal-inspector__section journal-inspector__audio"><h4><Music2 size={15} />为这一页配乐</h4><label>音乐锚点<select value={trackForBlock} onChange={event => setTrackForBlock(event.target.value)}><option value="">选择作品曲目</option>{tracks.map(track => <option key={track.id} value={track.id}>{track.displayName}</option>)}</select></label><small>添加音乐时，保留所选曲目和当前播放位置。</small><label>页面 BGM<select value={page.soundtrackTrackId ?? ''} onChange={event => editPage({ ...page, soundtrackTrackId: event.target.value || null })}><option value="">不设置</option>{tracks.map(track => <option key={track.id} value={track.id}>{track.displayName}</option>)}</select></label>{page.soundtrackTrackId && <button type="button" className="journal-button" onClick={() => { const track = tracks.find(item => item.id === page.soundtrackTrackId); if (track) onPlayTrack(track); }}><Play size={14} />播放 BGM</button>}</div>
          <div className="journal-inspector__section"><PlaySessionPicker gameId={game.id} disabled={busy} onInsert={insertPlaySessionCard} /></div>
        </aside>}
      </div>
      <div className="journal-workspace__bottomline"><span><BookOpen size={13} />第 {activeIndex + 1} 页 / 共 {pages.length} 页<span className="journal-bottomline-dot">·</span>{page.blocks.length} 个记忆</span><span className="journal-page-navigation"><button type="button" className="journal-icon" aria-label="上一页" disabled={busy || activeIndex <= 0} onClick={() => void switchPage(pages[activeIndex - 1].id)}><ChevronLeft size={16} /></button><button type="button" className="journal-icon" aria-label="下一页" disabled={busy || activeIndex >= pages.length - 1} onClick={() => void switchPage(pages[activeIndex + 1].id)}><ChevronRight size={16} /></button></span></div>
      {memoryMode && <JournalMemoryDialog game={game} pages={pages.map(item => item.id === page.id ? page : item)} initialIndex={activeIndex} tracks={tracks} assets={assets} onPlayTrack={onPlayTrack} onClose={() => setMemoryMode(false)} />}
    </section>
  );
}
