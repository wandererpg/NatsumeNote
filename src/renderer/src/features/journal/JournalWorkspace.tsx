import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  ImagePlus,
  Lock,
  Maximize2,
  Minus,
  Music2,
  Play,
  Plus,
  Quote,
  Redo2,
  RotateCw,
  Save,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Video,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { toCoverUrl } from '../../../../shared/cover-url';
import { toJournalMediaUrl } from '../../../../shared/journal-media-url';
import type {
  Game,
  JournalAsset,
  JournalBlock,
  JournalPage,
  JournalPageCreate,
  Track,
} from '../../../../shared/types';
import { useJournalHistory } from './useJournalHistory';
import {
  addJournalBlock,
  createBlankJournalPage,
  createJournalMediaBlock,
  createJournalQuoteBlock,
  createJournalTextBlock,
  createJournalTrackBlock,
  duplicateJournalBlock,
  expandJournalCanvas,
  moveJournalBlock,
  removeJournalBlock,
  resizeJournalBlock,
  rotateJournalBlock,
  setJournalBlockZIndex,
  updateJournalBackground,
  updateJournalBlock,
} from './journal-model';
import { downloadJournalPagePng, downloadJournalPageSvg } from './journal-export';

export interface JournalWorkspaceProps {
  game: Game;
  tracks: Track[];
  currentTrack?: Track | null;
  currentTime?: number;
  onPlayTrack(track: Track): void;
  onSeekTo(seconds: number): void;
}

type Interaction =
  | { kind: 'move'; blockId: string; startX: number; startY: number; page: JournalPage }
  | { kind: 'resize'; blockId: string; startX: number; startY: number; page: JournalPage }
  | null;

function getApi() {
  if (typeof window === 'undefined') return undefined;
  return window.galMusic;
}

function id(): string {
  return globalThis.crypto?.randomUUID?.() ?? `journal-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTrackTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '从头播放';
  const total = Math.max(0, Math.floor(seconds));
  return `从 ${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')} 开始`;
}

function mergeAssets(current: JournalAsset[], incoming: JournalAsset[]): JournalAsset[] {
  const map = new Map(current.map((asset) => [asset.id, asset]));
  incoming.forEach((asset) => map.set(asset.id, asset));
  return [...map.values()];
}

function defaultPageInput(gameId: string, pageId: string, title: string): JournalPageCreate {
  const page = createBlankJournalPage(gameId, pageId, title);
  const textBlock = createJournalTextBlock(id(), 64, 132);
  return {
    id: page.id,
    gameId: page.gameId,
    title: page.title,
    canvasWidth: page.canvasWidth,
    canvasHeight: page.canvasHeight,
    background: page.background,
    blocks: [textBlock],
    tags: ['初见'],
    soundtrackTrackId: null,
  };
}

function BlockBody({
  block,
  asset,
  track,
  onTextChange,
  onQuoteChange,
  onCaptionChange,
  onTrackNoteChange,
  onPlayTrack,
  onSeekTo,
}: {
  block: JournalBlock;
  asset?: JournalAsset;
  track?: Track;
  onTextChange(blockId: string, value: string): void;
  onQuoteChange(blockId: string, field: 'quote' | 'attribution', value: string): void;
  onCaptionChange(blockId: string, value: string): void;
  onTrackNoteChange(blockId: string, value: string): void;
  onPlayTrack(track: Track): void;
  onSeekTo(seconds: number): void;
}) {
  if (block.type === 'text') {
    return (
      <textarea
        className="journal-block__text-input"
        value={block.text}
        onChange={(event) => onTextChange(block.id, event.target.value)}
        placeholder="写下此刻…"
        style={{ color: block.color, fontSize: `${block.fontSize}px`, textAlign: block.align, background: block.backgroundColor }}
        aria-label="手账文字"
      />
    );
  }

  if (block.type === 'quote') {
    return (
      <div className="journal-block__quote-content" style={{ borderLeftColor: block.accentColor }}>
        <textarea
          className="journal-block__quote-input"
          value={block.quote}
          onChange={(event) => onQuoteChange(block.id, 'quote', event.target.value)}
          aria-label="引用内容"
        />
        <input
          className="journal-block__attribution-input"
          value={block.attribution}
          onChange={(event) => onQuoteChange(block.id, 'attribution', event.target.value)}
          placeholder="署名（可选）"
          aria-label="引用署名"
        />
      </div>
    );
  }

  if (block.type === 'image' || block.type === 'video') {
    return (
      <div className="journal-block__media-content">
        {asset && block.type === 'image' ? (
          <img src={toJournalMediaUrl(asset.filePath)} alt={block.caption || asset.fileName} />
        ) : asset && block.type === 'video' ? (
          <video src={toJournalMediaUrl(asset.filePath)} controls preload="metadata" />
        ) : (
          <div className="journal-block__media-missing"><Sparkles size={25} /><span>素材暂不可用</span></div>
        )}
        <input
          className="journal-block__caption-input"
          value={block.caption}
          onChange={(event) => onCaptionChange(block.id, event.target.value)}
          placeholder={asset?.fileName ?? '添加说明…'}
          aria-label="素材说明"
        />
      </div>
    );
  }

  if (block.type === 'track') {
    return (
      <div className="journal-block__track-content">
        <div className="journal-block__track-disc"><Music2 size={24} /></div>
        <div className="journal-block__track-copy">
          <span>音乐片段</span>
          <strong>{track?.displayName ?? '未找到曲目'}</strong>
          <small>{formatTrackTime(block.startTime)}</small>
        </div>
        {track && (
          <button
            className="journal-block__track-play"
            type="button"
            aria-label="播放这段音乐"
            onClick={(event) => {
              event.stopPropagation();
              onPlayTrack(track);
              if (block.startTime !== null) window.setTimeout(() => onSeekTo(block.startTime ?? 0), 100);
            }}
          ><Play size={15} fill="currentColor" /></button>
        )}
        <input
          className="journal-block__track-note"
          value={block.note}
          onChange={(event) => onTrackNoteChange(block.id, event.target.value)}
          placeholder="这首曲子让我想起…"
          aria-label="音乐笔记"
        />
      </div>
    );
  }

  return null;
}

export function JournalWorkspace({ game, tracks, currentTrack, currentTime = 0, onPlayTrack, onSeekTo }: JournalWorkspaceProps) {
  const [pages, setPages] = useState<JournalPage[]>([]);
  const [assets, setAssets] = useState<JournalAsset[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [memoryMode, setMemoryMode] = useState(false);
  const [memoryPageIndex, setMemoryPageIndex] = useState(0);
  const [zoom, setZoom] = useState(0.9);
  const [trackForBlock, setTrackForBlock] = useState(currentTrack?.id ?? tracks[0]?.id ?? '');
  const [interactionDraft, setInteractionDraft] = useState<JournalPage | null>(null);
  const interactionRef = useRef<Interaction>(null);
  const saveTimerRef = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const activePage = pages.find((page) => page.id === activePageId) ?? null;
  const history = useJournalHistory(activePage);
  const page = interactionDraft ?? history.page;

  useEffect(() => {
    setTrackForBlock(currentTrack?.id ?? tracks[0]?.id ?? '');
  }, [currentTrack?.id, tracks]);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    const api = getApi();
    try {
      const [loadedPages, loadedAssets] = await Promise.all([
        api?.getJournalPages?.(game.id) ?? Promise.resolve([]),
        api?.getJournalAssets?.(game.id) ?? Promise.resolve([]),
      ]);
      let nextPages: JournalPage[] = loadedPages.map((loadedPage) => ({
        ...loadedPage,
        blocks: loadedPage.blocks.filter((block) => block.type !== 'details'),
      }));
      if (nextPages.length === 0) {
        const initial = defaultPageInput(game.id, id(), '初见 · 作品手账');
        const created = api?.createJournalPage ? await api.createJournalPage(initial) : createBlankJournalPage(game.id, initial.id, initial.title);
        if (!api?.createJournalPage) {
          created.blocks = initial.blocks ?? [];
          created.tags = initial.tags ?? [];
          created.background = initial.background ?? created.background;
        }
        nextPages = [created];
      }
      setPages(nextPages);
      setAssets(loadedAssets);
      setActivePageId((current) => nextPages.some((pageItem) => pageItem.id === current) ? current : nextPages[0]?.id ?? null);
      setDirty(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [game.id]);

  useEffect(() => {
    void loadWorkspace();
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [loadWorkspace]);

  const commitPage = useCallback((next: JournalPage) => {
    history.commit(next);
    setDirty(true);
    setNotice(null);
  }, [history]);

  const replacePage = useCallback((next: JournalPage) => {
    history.replace(next);
    setDirty(true);
  }, [history]);

  const savePage = useCallback(async (pageToSave = history.page) => {
    if (!pageToSave.id) return;
    const api = getApi();
    if (!api?.saveJournalPage) {
      setDirty(false);
      return;
    }
    setSaving(true);
    try {
      const saved = await api.saveJournalPage({
        id: pageToSave.id,
        gameId: pageToSave.gameId,
        title: pageToSave.title,
        position: pageToSave.position,
        canvasWidth: pageToSave.canvasWidth,
        canvasHeight: pageToSave.canvasHeight,
        background: pageToSave.background,
        blocks: pageToSave.blocks,
        tags: pageToSave.tags,
        soundtrackTrackId: pageToSave.soundtrackTrackId,
        revision: pageToSave.revision,
      });
      setPages((current) => current.map((item) => item.id === saved.id ? saved : item));
      if (history.page.id === saved.id && history.page.revision === pageToSave.revision) {
        history.replace(saved);
        setDirty(false);
      }
      setNotice('已保存');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [history]);

  useEffect(() => {
    if (!dirty || !history.page.id) return;
    const pageId = history.page.id;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      if (activePageId === pageId) void savePage(history.page);
    }, 900);
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [activePageId, dirty, history.page, savePage]);

  const createPage = async () => {
    const input = defaultPageInput(game.id, id(), `第 ${pages.length + 1} 页`);
    const api = getApi();
    setBusy(true);
    try {
      const next = api?.createJournalPage ? await api.createJournalPage(input) : Object.assign(createBlankJournalPage(game.id, input.id, input.title), {
        blocks: input.blocks ?? [], tags: input.tags ?? [], background: input.background ?? { color: '#fffaf0', pattern: 'paper' },
      });
      setPages((current) => [...current, next]);
      setActivePageId(next.id);
      setSelectedBlockId(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const deletePage = async () => {
    if (!activePage || pages.length <= 1) {
      setNotice('至少保留一张手账页面');
      return;
    }
    if (!window.confirm(`删除“${activePage.title}”？`)) return;
    const api = getApi();
    setBusy(true);
    try {
      await api?.deleteJournalPage?.(activePage.id);
      const remaining = pages.filter((item) => item.id !== activePage.id);
      setPages(remaining);
      setActivePageId(remaining[0]?.id ?? null);
      setSelectedBlockId(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const addBlock = (block: JournalBlock) => {
    const next = addJournalBlock(page, block);
    commitPage(next);
    setSelectedBlockId(block.id);
  };

  const addMedia = async (kind: 'image' | 'video') => {
    const api = getApi();
    if (!api?.selectJournalMedia) {
      setNotice('当前环境没有素材导入桥接');
      return;
    }
    setBusy(true);
    try {
      const imported = await api.selectJournalMedia(game.id, kind);
      setAssets((current) => mergeAssets(current, imported));
      let nextPage = page;
      let lastBlockId: string | null = null;
      imported.forEach((asset, index) => {
        const block = createJournalMediaBlock(id(), kind, asset.id, 80 + (index % 3) * 40, 150 + (index % 2) * 40);
        nextPage = addJournalBlock(nextPage, block);
        lastBlockId = block.id;
      });
      if (imported.length > 0) {
        commitPage(nextPage);
        setSelectedBlockId(lastBlockId);
      }
      if (imported.length > 0) setNotice(`已导入 ${imported.length} 个${kind === 'image' ? '图片' : '视频'}素材`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const addTrack = () => {
    const track = tracks.find((item) => item.id === trackForBlock) ?? currentTrack ?? tracks[0];
    if (!track) {
      setNotice('当前作品还没有曲目');
      return;
    }
    addBlock(createJournalTrackBlock(id(), track.id, currentTrack?.id === track.id ? currentTime : null, 80, 420));
  };

  const selectedBlock = page.blocks.find((block) => block.id === selectedBlockId) ?? null;
  const selectedAsset = selectedBlock?.type === 'image' || selectedBlock?.type === 'video'
    ? assets.find((asset) => asset.id === selectedBlock.assetId)
    : undefined;
  const selectedTrack = selectedBlock?.type === 'track' ? tracks.find((track) => track.id === selectedBlock.trackId) : undefined;
  const coverUrl = game.coverPath ? toCoverUrl(game.coverPath) : null;

  const beginInteraction = (event: React.PointerEvent, block: JournalBlock, kind: Interaction extends infer T ? T extends { kind: infer K } ? K : never : never) => {
    event.stopPropagation();
    if (block.locked || (event.target as HTMLElement).closest('textarea, input, select, button, a')) {
      setSelectedBlockId(block.id);
      return;
    }
    event.preventDefault();
    setSelectedBlockId(block.id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    interactionRef.current = { kind: kind as 'move' | 'resize', blockId: block.id, startX: event.clientX, startY: event.clientY, page };
  };

  const updateInteraction = (event: React.PointerEvent) => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    const deltaX = (event.clientX - interaction.startX) / zoom;
    const deltaY = (event.clientY - interaction.startY) / zoom;
    const interactionBlock = interaction.page.blocks.find((block) => block.id === interaction.blockId);
    const next = interaction.kind === 'move'
      ? moveJournalBlock(interaction.page, interaction.blockId, deltaX, deltaY)
      : resizeJournalBlock(interaction.page, interaction.blockId, (interactionBlock?.width ?? 40) + deltaX, (interactionBlock?.height ?? 40) + deltaY);
    setInteractionDraft(next);
  };

  const finishInteraction = () => {
    if (interactionDraft) commitPage(interactionDraft);
    interactionRef.current = null;
    setInteractionDraft(null);
  };

  const mutateBlock = (blockId: string, patch: Partial<JournalBlock>) => commitPage(updateJournalBlock(page, blockId, patch));

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editingField = Boolean(target?.closest('textarea, input, select, [contenteditable="true"]'));
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'z' && !editingField) {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
        setDirty(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'd' && selectedBlockId && !editingField) {
        event.preventDefault();
        const copiedId = id();
        const next = duplicateJournalBlock(page, selectedBlockId, copiedId);
        if (next !== page) {
          commitPage(next);
          setSelectedBlockId(copiedId);
        }
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedBlockId && !editingField) {
        event.preventDefault();
        commitPage(removeJournalBlock(page, selectedBlockId));
        setSelectedBlockId(null);
      }
    };
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [commitPage, history, page, selectedBlockId]);

  const canvasPatternClass = `journal-canvas journal-canvas--${page.background.pattern}`;

  if (loading) {
    return <section className="journal-workspace journal-workspace--loading" aria-live="polite"><span className="loading-state__spinner" />正在打开手账…</section>;
  }

  return (
    <section className="journal-workspace" aria-label="作品手账">
      <div className="journal-workspace__topline">
        <div className="journal-workspace__identity">
          <div className="journal-workspace__eyebrow"><BookOpen size={15} />作品手账</div>
          <h2>{game.name}</h2>
          <span>{pages.length} 张页面 · {page.blocks.length} 个记忆对象</span>
        </div>
        <div className="journal-workspace__actions">
          <span className={`journal-save-status${dirty ? ' is-dirty' : ''}`} role="status">{saving ? '保存中…' : notice ?? (dirty ? '有未保存更改' : '已同步')}</span>
          <button className="button button--ghost" type="button" onClick={() => void downloadJournalPagePng(page, { gameName: game.name, tracks, assets, coverUrl })}><Download size={14} />导出 PNG</button>
          <button className="button button--ghost journal-export-svg" type="button" onClick={() => downloadJournalPageSvg(page, { gameName: game.name, tracks, assets, coverUrl })}>SVG</button>
          <button className="button button--ghost" type="button" onClick={() => { setMemoryPageIndex(pages.findIndex((item) => item.id === activePageId)); setMemoryMode(true); }}><BookOpen size={14} />记忆模式</button>
          <button className="button button--primary" type="button" onClick={() => void savePage()} disabled={saving || !dirty}><Save size={14} />保存</button>
        </div>
      </div>
      {memoryMode && pages[memoryPageIndex] && (
        <div className="journal-memory-overlay" role="presentation" onMouseDown={() => setMemoryMode(false)}>
          <div className="journal-memory-dialog" role="dialog" aria-modal="true" aria-label="记忆模式" onMouseDown={(event) => event.stopPropagation()}>
            <div className="journal-memory-dialog__topline"><span>记忆模式 · {memoryPageIndex + 1} / {pages.length}</span><button type="button" className="icon-button" aria-label="关闭记忆模式" onClick={() => setMemoryMode(false)}>×</button></div>
            <div className={`journal-memory-page journal-memory-page--${pages[memoryPageIndex].background.pattern}`} style={{ backgroundColor: pages[memoryPageIndex].background.color }}>
              <span className="journal-memory-page__game">{game.name}</span>
              <h3>{pages[memoryPageIndex].title}</h3>
              <div className="journal-memory-page__rule" />
              <div className="journal-memory-page__blocks">
                {pages[memoryPageIndex].blocks.filter((block) => block.type !== 'details').slice().sort((left, right) => left.zIndex - right.zIndex).map((memoryBlock) => (
                  <div key={memoryBlock.id} className="journal-memory-page__block">
                    <strong>{memoryBlock.type === 'text' ? '便签' : memoryBlock.type === 'quote' ? '引用' : memoryBlock.type === 'track' ? '音乐片段' : memoryBlock.type === 'image' ? '图片素材' : '视频素材'}</strong>
                    <span>{memoryBlock.type === 'text' ? (memoryBlock.text || '空白便签') : memoryBlock.type === 'quote' ? memoryBlock.quote : memoryBlock.type === 'track' ? (tracks.find((track) => track.id === memoryBlock.trackId)?.displayName ?? '未找到曲目') : (assets.find((asset) => asset.id === memoryBlock.assetId)?.fileName ?? '素材')}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="journal-memory-dialog__footer"><button className="button button--ghost" type="button" onClick={() => setMemoryPageIndex((index) => Math.max(0, index - 1))} disabled={memoryPageIndex <= 0}><ChevronLeft size={14} />上一页</button><button className="button button--ghost" type="button" onClick={() => { const track = tracks.find((item) => item.id === pages[memoryPageIndex].soundtrackTrackId); if (track) onPlayTrack(track); }} disabled={!pages[memoryPageIndex].soundtrackTrackId}><Play size={14} />播放页面 BGM</button><button className="button button--ghost" type="button" onClick={() => setMemoryPageIndex((index) => Math.min(pages.length - 1, index + 1))} disabled={memoryPageIndex >= pages.length - 1}>下一页<ChevronRight size={14} /></button></div>
          </div>
        </div>
      )}

      <div className="journal-page-tabs" role="tablist" aria-label="手账页面">
        <button className="journal-page-tabs__arrow" type="button" aria-label="上一页" onClick={() => { const index = pages.findIndex((item) => item.id === activePageId); setActivePageId(pages[Math.max(0, index - 1)]?.id ?? activePageId); }}><ChevronLeft size={16} /></button>
        <div className="journal-page-tabs__list">
          {pages.map((item, index) => (
            <button key={item.id} className={`journal-page-tab${item.id === activePageId ? ' is-active' : ''}`} type="button" role="tab" aria-selected={item.id === activePageId} onClick={() => { setActivePageId(item.id); setSelectedBlockId(null); }}>
              <span>{String(index + 1).padStart(2, '0')}</span>{item.title || '未命名页面'}
            </button>
          ))}
        </div>
        <button className="journal-page-tabs__arrow" type="button" aria-label="下一页" onClick={() => { const index = pages.findIndex((item) => item.id === activePageId); setActivePageId(pages[Math.min(pages.length - 1, index + 1)]?.id ?? activePageId); }}><ChevronRight size={16} /></button>
        <button className="journal-page-tabs__new" type="button" onClick={() => void createPage()} disabled={busy}><Plus size={15} />新页面</button>
      </div>

      <div className="journal-workspace__body">
        <aside className="journal-toolbox">
          <div className="journal-panel-heading"><span>工具</span><small>添加</small></div>
          <div className="journal-toolbox__grid">
            <button type="button" title="添加便签" aria-label="便签" onClick={() => addBlock(createJournalTextBlock(id(), 64, 132))}><Type size={16} /><span>便签</span></button>
            <button type="button" title="添加引用" aria-label="引用" onClick={() => addBlock(createJournalQuoteBlock(id(), 82, 148))}><Quote size={16} /><span>引用</span></button>
            <button type="button" title="导入图片" aria-label="图片" onClick={() => void addMedia('image')} disabled={busy}><ImagePlus size={16} /><span>图片</span></button>
            <button type="button" title="导入视频" aria-label="视频" onClick={() => void addMedia('video')} disabled={busy}><Video size={16} /><span>视频</span></button>
            <button type="button" title="添加音乐片段" aria-label="音乐" onClick={addTrack}><Music2 size={16} /><span>音乐</span></button>
          </div>
        </aside>

        <div className="journal-editor">
          <div className="journal-editor__toolbar">
            <div className="journal-editor__toolbar-group">
              <button type="button" className="icon-button icon-button--small" aria-label="撤销" title="撤销" onClick={() => { history.undo(); setDirty(true); }} disabled={!history.canUndo}><Undo2 size={15} /></button>
              <button type="button" className="icon-button icon-button--small" aria-label="重做" title="重做" onClick={() => { history.redo(); setDirty(true); }} disabled={!history.canRedo}><Redo2 size={15} /></button>
              <span className="journal-editor__divider" />
              <button type="button" className="icon-button icon-button--small" aria-label="缩小画布" title="缩小画布" onClick={() => setZoom((value) => Math.max(0.55, value - 0.1))}><Minus size={15} /></button>
              <span className="journal-zoom-label">{Math.round(zoom * 100)}%</span>
              <button type="button" className="icon-button icon-button--small" aria-label="放大画布" title="放大画布" onClick={() => setZoom((value) => Math.min(1.35, value + 0.1))}><Plus size={15} /></button>
            </div>
            <div className="journal-editor__toolbar-group journal-editor__toolbar-group--right">
              <span className="journal-canvas-size">{page.canvasWidth} × {page.canvasHeight}</span>
              <button type="button" className="button button--ghost" onClick={() => commitPage(expandJournalCanvas(page, 'width'))}><Maximize2 size={13} />扩展横向</button>
              <button type="button" className="button button--ghost" onClick={() => commitPage(expandJournalCanvas(page, 'height'))}><Maximize2 size={13} className="is-rotated-90" />扩展纵向</button>
            </div>
          </div>

          <div
            ref={viewportRef}
            className="journal-canvas-viewport"
            onPointerMove={updateInteraction}
            onPointerUp={finishInteraction}
            onPointerCancel={finishInteraction}
          >
            <div className="journal-canvas-sizer" style={{ width: page.canvasWidth * zoom, height: page.canvasHeight * zoom }}>
              <div
                className={canvasPatternClass}
                style={{ width: page.canvasWidth, height: page.canvasHeight, transform: `scale(${zoom})`, backgroundColor: page.background.color }}
                onPointerDown={() => setSelectedBlockId(null)}
              >
                <div className="journal-canvas__header">
                  <input className="journal-canvas__title" value={page.title} onChange={(event) => replacePage({ ...page, title: event.target.value })} onBlur={() => setDirty(true)} aria-label="手账页面标题" />
                  <span>{game.name}</span>
                </div>
                {page.blocks.slice().sort((left, right) => left.zIndex - right.zIndex).map((block) => {
                  const asset = block.type === 'image' || block.type === 'video' ? assets.find((item) => item.id === block.assetId) : undefined;
                  const track = block.type === 'track' ? tracks.find((item) => item.id === block.trackId) : undefined;
                  const isSelected = block.id === selectedBlockId;
                  return (
                    <div
                      key={block.id}
                      className={`journal-block journal-block--${block.type}${isSelected ? ' is-selected' : ''}${block.locked ? ' is-locked' : ''}`}
                      style={{ left: block.x, top: block.y, width: block.width, height: block.height, zIndex: block.zIndex, transform: `rotate(${block.rotation}deg)` }}
                      onPointerDown={(event) => beginInteraction(event, block, 'move')}
                    >
                      <BlockBody
                        block={block}
                        asset={asset}
                        track={track}
                        onTextChange={(blockId, value) => mutateBlock(blockId, { text: value })}
                        onQuoteChange={(blockId, field, value) => mutateBlock(blockId, { [field]: value })}
                        onCaptionChange={(blockId, value) => mutateBlock(blockId, { caption: value })}
                        onTrackNoteChange={(blockId, value) => mutateBlock(blockId, { note: value })}
                        onPlayTrack={onPlayTrack}
                        onSeekTo={onSeekTo}
                      />
                      {isSelected && (
                        <>
                          <div className="journal-block__selection-label">{block.type === 'text' ? '文字' : block.type === 'details' ? '作品详情' : block.type === 'track' ? '音乐' : block.type === 'quote' ? '引用' : block.type === 'image' ? '图片' : '视频'}</div>
                          {!block.locked && <button className="journal-block__resize-handle" type="button" aria-label="调整大小" onPointerDown={(event) => beginInteraction(event, block, 'resize')} />}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <aside className="journal-inspector">
          <div className="journal-panel-heading"><span>页面与对象</span><small>{selectedBlock ? '对象设置' : '页面设置'}</small></div>
          {selectedBlock ? (
            <div className="journal-inspector__object">
              <div className="journal-inspector__object-title"><span>{selectedBlock.type === 'track' ? '音乐片段' : selectedBlock.type === 'text' ? '便签' : selectedBlock.type === 'quote' ? '引用卡片' : selectedBlock.type === 'image' ? '图片素材' : selectedBlock.type === 'video' ? '视频素材' : '旧详情卡'}</span><span className="journal-inspector__id">{selectedBlock.id.slice(-6)}</span></div>
              <div className="journal-inspector__metrics"><label>X <input type="number" value={Math.round(selectedBlock.x)} onChange={(event) => mutateBlock(selectedBlock.id, { x: Number(event.target.value) })} /></label><label>Y <input type="number" value={Math.round(selectedBlock.y)} onChange={(event) => mutateBlock(selectedBlock.id, { y: Number(event.target.value) })} /></label><label>宽 <input type="number" value={Math.round(selectedBlock.width)} onChange={(event) => commitPage(resizeJournalBlock(page, selectedBlock.id, Number(event.target.value), selectedBlock.height))} /></label><label>高 <input type="number" value={Math.round(selectedBlock.height)} onChange={(event) => commitPage(resizeJournalBlock(page, selectedBlock.id, selectedBlock.width, Number(event.target.value)))} /></label></div>
              {selectedBlock.type === 'text' && (
                <div className="journal-inspector__style-grid">
                  <label>便签纸<input className="journal-color-input" type="color" value={selectedBlock.backgroundColor} onChange={(event) => mutateBlock(selectedBlock.id, { backgroundColor: event.target.value })} /></label>
                  <label>文字色<input className="journal-color-input" type="color" value={selectedBlock.color} onChange={(event) => mutateBlock(selectedBlock.id, { color: event.target.value })} /></label>
                  <label>字号<input type="number" min="12" max="72" value={selectedBlock.fontSize} onChange={(event) => mutateBlock(selectedBlock.id, { fontSize: Math.min(72, Math.max(12, Number(event.target.value))) })} /></label>
                </div>
              )}
              <div className="journal-inspector__actions"><button type="button" className="button button--ghost" onClick={() => commitPage(rotateJournalBlock(page, selectedBlock.id, -5))}><RotateCw size={13} className="is-flipped" />左转</button><button type="button" className="button button--ghost" onClick={() => commitPage(rotateJournalBlock(page, selectedBlock.id, 5))}><RotateCw size={13} />右转</button><button type="button" className="button button--ghost" onClick={() => mutateBlock(selectedBlock.id, { locked: !selectedBlock.locked })}>{selectedBlock.locked ? <Unlock size={13} /> : <Lock size={13} />}{selectedBlock.locked ? '解锁' : '锁定'}</button></div>
              <div className="journal-inspector__actions"><button type="button" className="button button--ghost" onClick={() => commitPage(setJournalBlockZIndex(page, selectedBlock.id, Math.max(...page.blocks.map((item) => item.zIndex), 0) + 1))}>置顶</button><button type="button" className="button button--ghost" onClick={() => commitPage(setJournalBlockZIndex(page, selectedBlock.id, Math.min(...page.blocks.map((item) => item.zIndex), 0) - 1))}>置底</button><button type="button" className="button button--danger" onClick={() => { commitPage(removeJournalBlock(page, selectedBlock.id)); setSelectedBlockId(null); }}><Trash2 size={13} />删除</button></div>
              {selectedAsset && <p className="journal-inspector__hint">素材：{selectedAsset.fileName}</p>}
              {selectedTrack && <p className="journal-inspector__hint">曲目：{selectedTrack.displayName}</p>}
            </div>
          ) : (
            <div className="journal-inspector__page">
              <label>页面标题<input value={page.title} onChange={(event) => replacePage({ ...page, title: event.target.value })} /></label>
              <label>标签 <span className="journal-inspector__label-hint">逗号分隔</span><input value={page.tags.join('，')} onChange={(event) => replacePage({ ...page, tags: event.target.value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 30) })} /></label>
              <label>纸张颜色<input className="journal-color-input" type="color" value={page.background.color} onChange={(event) => commitPage(updateJournalBackground(page, { color: event.target.value }))} /></label>
              <label>纸张纹理<select value={page.background.pattern} onChange={(event) => commitPage(updateJournalBackground(page, { pattern: event.target.value as JournalPage['background']['pattern'] }))}><option value="paper">纸张</option><option value="plain">纯色</option><option value="grid">方格</option><option value="dots">点阵</option></select></label>
              <div className="journal-inspector__page-actions"><button className="button button--danger" type="button" onClick={() => void deletePage()} disabled={busy || pages.length <= 1}><Trash2 size={13} />删除页面</button></div>
              {coverUrl && <div className="journal-inspector__cover"><img src={coverUrl} alt="" /></div>}
            </div>
          )}
          <div className="journal-inspector__audio">
            <div className="journal-inspector__section-title">声音</div>
            <label htmlFor="journal-track-select">音乐锚点</label>
            <select id="journal-track-select" value={trackForBlock} onChange={(event) => setTrackForBlock(event.target.value)}>
              <option value="">选择当前作品曲目</option>
              {tracks.map((track) => <option key={track.id} value={track.id}>{track.displayName}</option>)}
            </select>
            <small>点击左侧音乐工具时，记录所选曲目和当前播放位置。</small>
            <label htmlFor="journal-soundtrack-select">页面 BGM</label>
            <select id="journal-soundtrack-select" value={page.soundtrackTrackId ?? ''} onChange={(event) => commitPage({ ...page, soundtrackTrackId: event.target.value || null })}>
              <option value="">不设置</option>
              {tracks.map((track) => <option key={track.id} value={track.id}>{track.displayName}</option>)}
            </select>
            {page.soundtrackTrackId && <button className="button button--ghost journal-toolbox__play" type="button" onClick={() => { const track = tracks.find((item) => item.id === page.soundtrackTrackId); if (track) onPlayTrack(track); }}><Play size={13} />播放 BGM</button>}
          </div>
        </aside>
      </div>
    </section>
  );
}
