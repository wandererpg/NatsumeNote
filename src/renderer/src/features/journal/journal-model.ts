import type {
  JournalBlock,
  JournalDetailsBlock,
  JournalMediaBlock,
  JournalPage,
  JournalPageBackground,
  JournalQuoteBlock,
  JournalTrackBlock,
  JournalTextBlock,
} from '../../../../shared/types';

export const DEFAULT_JOURNAL_CANVAS = { width: 960, height: 680 } as const;
export const JOURNAL_CANVAS_STEP = { width: 320, height: 240 } as const;

const MIN_BLOCK_SIZE = 40;

function frame(id: string, x: number, y: number, width: number, height: number, zIndex = 0) {
  return {
    id,
    x,
    y,
    width,
    height,
    rotation: 0,
    zIndex,
    locked: false,
  };
}

function maxZIndex(blocks: JournalBlock[]): number {
  return blocks.reduce((maximum, block) => Math.max(maximum, block.zIndex), -1);
}

function clampSize(value: number): number {
  return Math.max(MIN_BLOCK_SIZE, Math.round(value));
}

export function createBlankJournalPage(gameId: string, id: string, title = '新的手账页面'): JournalPage {
  const now = new Date().toISOString();
  return {
    id,
    gameId,
    title,
    position: 0,
    canvasWidth: DEFAULT_JOURNAL_CANVAS.width,
    canvasHeight: DEFAULT_JOURNAL_CANVAS.height,
    background: { color: '#fffaf0', pattern: 'paper' },
    blocks: [],
    tags: [],
    soundtrackTrackId: null,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function createJournalTextBlock(id: string, x = 48, y = 48, zIndex = 0): JournalTextBlock {
  return {
    type: 'text',
    ...frame(id, x, y, 240, 210, zIndex),
    text: '',
    color: '#342d2a',
    backgroundColor: '#fff2a8',
    fontSize: 18,
    align: 'left',
  };
}

export function createJournalQuoteBlock(id: string, x = 80, y = 80, zIndex = 0): JournalQuoteBlock {
  return {
    type: 'quote',
    ...frame(id, x, y, 440, 170, zIndex),
    quote: '把此刻留在这里。',
    attribution: '',
    accentColor: '#c86b58',
  };
}

export function createJournalMediaBlock(
  id: string,
  kind: 'image' | 'video',
  assetId: string,
  x = 80,
  y = 80,
  zIndex = 0,
): JournalMediaBlock {
  return {
    type: kind,
    ...frame(id, x, y, kind === 'image' ? 320 : 420, kind === 'image' ? 240 : 260, zIndex),
    assetId,
    caption: '',
  };
}

export function createJournalTrackBlock(
  id: string,
  trackId: string,
  startTime: number | null = null,
  x = 80,
  y = 80,
  zIndex = 0,
): JournalTrackBlock {
  return {
    type: 'track',
    ...frame(id, x, y, 360, 150, zIndex),
    trackId,
    startTime,
    note: '',
  };
}

export function createJournalDetailsBlock(
  id: string,
  x = 80,
  y = 80,
  zIndex = 0,
  source: JournalDetailsBlock['source'] = 'auto',
): JournalDetailsBlock {
  return {
    type: 'details',
    ...frame(id, x, y, 360, 280, zIndex),
    source,
  };
}

export function addJournalBlock(page: JournalPage, block: JournalBlock): JournalPage {
  const nextBlock = { ...block, zIndex: maxZIndex(page.blocks) + 1 };
  return ensureJournalCanvasContains(
    { ...page, blocks: [...page.blocks, nextBlock] },
    nextBlock,
  );
}

export function updateJournalBlock(page: JournalPage, blockId: string, patch: Partial<JournalBlock>): JournalPage {
  return {
    ...page,
    blocks: page.blocks.map((block) => block.id === blockId ? { ...block, ...patch } as JournalBlock : block),
  };
}

export function moveJournalBlock(page: JournalPage, blockId: string, deltaX: number, deltaY: number): JournalPage {
  const block = page.blocks.find((item) => item.id === blockId);
  if (!block || block.locked) return page;
  const moved = { ...block, x: Math.round(block.x + deltaX), y: Math.round(block.y + deltaY) };
  return ensureJournalCanvasContains(updateJournalBlock(page, blockId, moved), moved);
}

export function resizeJournalBlock(page: JournalPage, blockId: string, width: number, height: number): JournalPage {
  const block = page.blocks.find((item) => item.id === blockId);
  if (!block || block.locked) return page;
  const resized = { ...block, width: clampSize(width), height: clampSize(height) };
  return ensureJournalCanvasContains(updateJournalBlock(page, blockId, resized), resized);
}

export function rotateJournalBlock(page: JournalPage, blockId: string, delta: number): JournalPage {
  const block = page.blocks.find((item) => item.id === blockId);
  if (!block || block.locked) return page;
  const nextRotation = ((block.rotation + delta + 540) % 360) - 180;
  return updateJournalBlock(page, blockId, { rotation: nextRotation });
}

export function setJournalBlockZIndex(page: JournalPage, blockId: string, zIndex: number): JournalPage {
  return updateJournalBlock(page, blockId, { zIndex: Math.round(zIndex) });
}

export function removeJournalBlock(page: JournalPage, blockId: string): JournalPage {
  return { ...page, blocks: page.blocks.filter((block) => block.id !== blockId) };
}

export function duplicateJournalBlock(page: JournalPage, blockId: string, newId: string): JournalPage {
  const source = page.blocks.find((block) => block.id === blockId);
  if (!source) return page;
  return addJournalBlock(page, { ...source, id: newId, x: source.x + 28, y: source.y + 28 });
}

export function expandJournalCanvas(page: JournalPage, axis: 'width' | 'height'): JournalPage {
  return {
    ...page,
    canvasWidth: axis === 'width' ? page.canvasWidth + JOURNAL_CANVAS_STEP.width : page.canvasWidth,
    canvasHeight: axis === 'height' ? page.canvasHeight + JOURNAL_CANVAS_STEP.height : page.canvasHeight,
  };
}

export function updateJournalBackground(page: JournalPage, background: Partial<JournalPageBackground>): JournalPage {
  return { ...page, background: { ...page.background, ...background } };
}

export function ensureJournalCanvasContains(page: JournalPage, block: Pick<JournalBlock, 'x' | 'y' | 'width' | 'height'>): JournalPage {
  const requiredWidth = Math.max(page.canvasWidth, block.x + block.width + 40);
  const requiredHeight = Math.max(page.canvasHeight, block.y + block.height + 40);
  const nextWidth = Math.ceil(requiredWidth / JOURNAL_CANVAS_STEP.width) * JOURNAL_CANVAS_STEP.width;
  const nextHeight = Math.ceil(requiredHeight / JOURNAL_CANVAS_STEP.height) * JOURNAL_CANVAS_STEP.height;
  return {
    ...page,
    canvasWidth: Math.max(page.canvasWidth, nextWidth),
    canvasHeight: Math.max(page.canvasHeight, nextHeight),
  };
}
