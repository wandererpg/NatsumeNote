import type {
  JournalBlock,
  JournalDetailsBlock,
  JournalPageBackground,
  JournalPageCreate,
  JournalPageDraft,
  JournalQuoteBlock,
  JournalTrackBlock,
  JournalTextBlock,
  JournalMediaBlock,
} from '../../shared/types';
import { assertNoUnexpectedKeys, assertRecord, assertString, invalidArgument } from './validation';

const JOURNAL_BLOCK_TYPES = new Set(['text', 'quote', 'image', 'video', 'track', 'details']);
const JOURNAL_PATTERNS = new Set(['plain', 'grid', 'dots', 'paper']);
const METADATA_SOURCES = new Set(['auto', 'vndb', 'bangumi']);

function text(value: unknown, label: string, maxLength: number, allowEmpty = false): string {
  assertString(value, label, { allowEmpty });
  if (value.length > maxLength) throw invalidArgument(`${label} must be at most ${maxLength} characters`);
  return value;
}

function numberInRange(value: unknown, label: string, minimum: number, maximum: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw invalidArgument(`${label} is out of range`);
  }
  return value;
}

function nullableString(value: unknown, label: string, maxLength: number): string | null {
  if (value === null) return null;
  return text(value, label, maxLength);
}

function validateFrame(value: Record<string, unknown>, label: string) {
  return {
    id: text(value.id, `${label}.id`, 120),
    x: numberInRange(value.x, `${label}.x`, -100_000, 100_000),
    y: numberInRange(value.y, `${label}.y`, -100_000, 100_000),
    width: numberInRange(value.width, `${label}.width`, 40, 20_000),
    height: numberInRange(value.height, `${label}.height`, 40, 20_000),
    rotation: numberInRange(value.rotation, `${label}.rotation`, -360, 360),
    zIndex: numberInRange(value.zIndex, `${label}.zIndex`, -100_000, 100_000, true),
    locked: value.locked as boolean,
  };
}

function validateBlock(value: unknown, index: number): JournalBlock {
  const label = `page.blocks[${index}]`;
  assertRecord(value, label);
  if (typeof value.type !== 'string' || !JOURNAL_BLOCK_TYPES.has(value.type)) {
    throw invalidArgument(`${label}.type is invalid`);
  }

  if (value.type === 'text') {
    assertNoUnexpectedKeys(value, ['type', 'id', 'x', 'y', 'width', 'height', 'rotation', 'zIndex', 'locked', 'text', 'color', 'backgroundColor', 'fontSize', 'align'], label);
    if (typeof value.locked !== 'boolean') throw invalidArgument(`${label}.locked must be a boolean`);
    if (value.align !== 'left' && value.align !== 'center' && value.align !== 'right') throw invalidArgument(`${label}.align is invalid`);
    return {
      type: 'text',
      ...validateFrame(value, label),
      text: text(value.text, `${label}.text`, 20_000, true),
      color: text(value.color, `${label}.color`, 100),
      backgroundColor: text(value.backgroundColor, `${label}.backgroundColor`, 100),
      fontSize: numberInRange(value.fontSize, `${label}.fontSize`, 10, 160),
      align: value.align,
    } satisfies JournalTextBlock;
  }

  if (value.type === 'quote') {
    assertNoUnexpectedKeys(value, ['type', 'id', 'x', 'y', 'width', 'height', 'rotation', 'zIndex', 'locked', 'quote', 'attribution', 'accentColor'], label);
    if (typeof value.locked !== 'boolean') throw invalidArgument(`${label}.locked must be a boolean`);
    return {
      type: 'quote',
      ...validateFrame(value, label),
      quote: text(value.quote, `${label}.quote`, 20_000, true),
      attribution: text(value.attribution, `${label}.attribution`, 500, true),
      accentColor: text(value.accentColor, `${label}.accentColor`, 100),
    } satisfies JournalQuoteBlock;
  }

  if (value.type === 'image' || value.type === 'video') {
    assertNoUnexpectedKeys(value, ['type', 'id', 'x', 'y', 'width', 'height', 'rotation', 'zIndex', 'locked', 'assetId', 'caption'], label);
    if (typeof value.locked !== 'boolean') throw invalidArgument(`${label}.locked must be a boolean`);
    return {
      type: value.type,
      ...validateFrame(value, label),
      assetId: text(value.assetId, `${label}.assetId`, 120),
      caption: text(value.caption, `${label}.caption`, 500, true),
    } satisfies JournalMediaBlock;
  }

  if (value.type === 'track') {
    assertNoUnexpectedKeys(value, ['type', 'id', 'x', 'y', 'width', 'height', 'rotation', 'zIndex', 'locked', 'trackId', 'startTime', 'note'], label);
    if (typeof value.locked !== 'boolean') throw invalidArgument(`${label}.locked must be a boolean`);
    const startTime = value.startTime === null
      ? null
      : numberInRange(value.startTime, `${label}.startTime`, 0, 86_400);
    return {
      type: 'track',
      ...validateFrame(value, label),
      trackId: text(value.trackId, `${label}.trackId`, 120),
      startTime,
      note: text(value.note, `${label}.note`, 2_000, true),
    } satisfies JournalTrackBlock;
  }

  assertNoUnexpectedKeys(value, ['type', 'id', 'x', 'y', 'width', 'height', 'rotation', 'zIndex', 'locked', 'source'], label);
  if (typeof value.locked !== 'boolean') throw invalidArgument(`${label}.locked must be a boolean`);
  if (typeof value.source !== 'string' || !METADATA_SOURCES.has(value.source)) throw invalidArgument(`${label}.source is invalid`);
  return {
    type: 'details',
    ...validateFrame(value, label),
    source: value.source as JournalDetailsBlock['source'],
  } satisfies JournalDetailsBlock;
}

function validateBlocks(value: unknown, label = 'page.blocks'): JournalBlock[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 500) throw invalidArgument(`${label} must contain at most 500 blocks`);
  return value.map((block, index) => validateBlock(block, index));
}

function validateTags(value: unknown, label = 'page.tags'): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30) throw invalidArgument(`${label} must contain at most 30 tags`);
  return value.map((tag, index) => text(tag, `${label}[${index}]`, 100));
}

function validateBackground(value: unknown): JournalPageBackground {
  if (value === undefined) return { color: '#fffaf0', pattern: 'paper' };
  assertRecord(value, 'page.background');
  assertNoUnexpectedKeys(value, ['color', 'pattern'], 'page.background');
  const pattern = value.pattern ?? 'paper';
  if (typeof pattern !== 'string' || !JOURNAL_PATTERNS.has(pattern)) throw invalidArgument('page.background.pattern is invalid');
  return {
    color: text(value.color, 'page.background.color', 100),
    pattern: pattern as JournalPageBackground['pattern'],
  };
}

function validateSoundtrack(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  return text(value, label, 120);
}

function validatePageCommon(value: Record<string, unknown>, label: string) {
  const canvasWidth = numberInRange(value.canvasWidth, `${label}.canvasWidth`, 400, 20_000, true);
  const canvasHeight = numberInRange(value.canvasHeight, `${label}.canvasHeight`, 300, 20_000, true);
  if (typeof value.position !== 'undefined') numberInRange(value.position, `${label}.position`, 0, 100_000, true);
  return {
    title: text(value.title, `${label}.title`, 200),
    position: value.position === undefined ? undefined : value.position as number,
    canvasWidth,
    canvasHeight,
    background: validateBackground(value.background),
    blocks: validateBlocks(value.blocks, `${label}.blocks`),
    tags: validateTags(value.tags, `${label}.tags`),
    soundtrackTrackId: validateSoundtrack(value.soundtrackTrackId, `${label}.soundtrackTrackId`),
  };
}

export function validateJournalPageCreate(value: unknown): JournalPageCreate {
  assertRecord(value, 'page');
  assertNoUnexpectedKeys(value, ['id', 'gameId', 'title', 'canvasWidth', 'canvasHeight', 'background', 'blocks', 'tags', 'soundtrackTrackId'], 'page');
  const common = validatePageCommon(value, 'page');
  return {
    id: text(value.id, 'page.id', 120),
    gameId: text(value.gameId, 'page.gameId', 120),
    title: common.title,
    canvasWidth: common.canvasWidth,
    canvasHeight: common.canvasHeight,
    background: common.background,
    blocks: common.blocks,
    tags: common.tags,
    soundtrackTrackId: common.soundtrackTrackId,
  };
}

export function validateJournalPageDraft(value: unknown): JournalPageDraft {
  assertRecord(value, 'page');
  assertNoUnexpectedKeys(value, ['id', 'gameId', 'title', 'position', 'canvasWidth', 'canvasHeight', 'background', 'blocks', 'tags', 'soundtrackTrackId', 'revision'], 'page');
  const common = validatePageCommon(value, 'page');
  return {
    id: text(value.id, 'page.id', 120),
    gameId: text(value.gameId, 'page.gameId', 120),
    title: common.title,
    position: common.position ?? 0,
    canvasWidth: common.canvasWidth,
    canvasHeight: common.canvasHeight,
    background: common.background,
    blocks: common.blocks,
    tags: common.tags,
    soundtrackTrackId: common.soundtrackTrackId,
    revision: numberInRange(value.revision, 'page.revision', 0, 100_000_000, true),
  };
}
