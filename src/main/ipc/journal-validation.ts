import type {
  JournalBlock,
  JournalDetailsBlock,
  JournalPageBackground,
  JournalPageCreate,
  JournalPageDraft,
  JournalPlaySessionBlock,
  JournalQuoteBlock,
  JournalTrackBlock,
  JournalTextBlock,
  JournalMediaBlock,
} from '../../shared/types';
import type { ReinaPlaySnapshot, ReinaSession } from '../../shared/reina';
import { assertNoUnexpectedKeys, assertRecord, assertString, invalidArgument } from './validation';

const JOURNAL_BLOCK_TYPES = new Set(['text', 'quote', 'image', 'video', 'track', 'details', 'play-session']);
const JOURNAL_PATTERNS = new Set(['plain', 'grid', 'dots', 'paper']);
const METADATA_SOURCES = new Set(['auto', 'vndb', 'bangumi']);

/** Insertion cap for a single historical play-session card. */
const MAX_PLAY_SESSION_CARD_SESSIONS = 20;

const ISO_DATE_TIME_PARTS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const ISO_DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Length of each month in a non-leap year; February is handled separately. */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * `Date.parse` normalizes impossible days (2026-02-30 becomes March 2), so the
 * calendar fields are checked by hand before a timestamp is accepted.
 */
function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  const daysInMonth = month === 2 && isLeapYear(year) ? 29 : MONTH_DAYS[month - 1];
  return day >= 1 && day <= daysInMonth;
}

function isValidIsoDateTime(value: string): boolean {
  if (value.length > 64) return false;
  const parts = ISO_DATE_TIME_PARTS.exec(value);
  if (!parts) return false;
  if (!isRealCalendarDate(Number(parts[1]), Number(parts[2]), Number(parts[3]))) return false;
  if (Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59) return false;
  const offsetHours = parts[8];
  if (offsetHours !== undefined && (Number(offsetHours) > 23 || Number(parts[9]) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

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

function isoDateTime(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isValidIsoDateTime(value)) {
    throw invalidArgument(`${label} must be an ISO-8601 date-time`);
  }
  return value;
}

function isoDate(value: unknown, label: string): string {
  const parts = typeof value === 'string' && value.length === 10 ? ISO_DATE_PARTS.exec(value) : null;
  if (!parts || !isRealCalendarDate(Number(parts[1]), Number(parts[2]), Number(parts[3]))) {
    throw invalidArgument(`${label} must be an ISO-8601 date`);
  }
  return value as string;
}

function isoDateTimeOrDate(value: unknown, label: string): string {
  if (typeof value === 'string' && isValidIsoDateTime(value)) return value;
  return isoDate(value, label);
}

function validatePlaySession(value: unknown, label: string, externalGameId: number, seenIds: Set<number>): ReinaSession {
  assertRecord(value, label);
  assertNoUnexpectedKeys(value, [
    'id',
    'gameId',
    'startTime',
    'endTime',
    'sourceDate',
    'recordedMinutes',
    'recordedDurationSeconds',
    'durationPrecision',
    'trackingMode',
    'recordKind',
  ], label);
  const gameId = numberInRange(value.gameId, `${label}.gameId`, 1, Number.MAX_SAFE_INTEGER, true);
  if (gameId !== externalGameId) throw invalidArgument(`${label}.gameId must match snapshot.externalGameId`);
  const startTime = isoDateTime(value.startTime, `${label}.startTime`);
  const endTime = isoDateTime(value.endTime, `${label}.endTime`);
  if (Date.parse(endTime) <= Date.parse(startTime)) throw invalidArgument(`${label}.endTime must be after startTime`);
  if (value.durationPrecision !== 'minute-rounded') throw invalidArgument(`${label}.durationPrecision is invalid`);
  if (value.trackingMode !== 'unknown') throw invalidArgument(`${label}.trackingMode is invalid`);
  if (value.recordKind !== 'unknown') throw invalidArgument(`${label}.recordKind is invalid`);
  const id = numberInRange(value.id, `${label}.id`, 1, Number.MAX_SAFE_INTEGER, true);
  if (seenIds.has(id)) throw invalidArgument(`${label}.id must be unique within snapshot.sessions`);
  seenIds.add(id);
  const recordedMinutes = numberInRange(value.recordedMinutes, `${label}.recordedMinutes`, 1, 1_000_000, true);
  const recordedDurationSeconds = numberInRange(value.recordedDurationSeconds, `${label}.recordedDurationSeconds`, 60, 60_000_000, true);
  if (recordedDurationSeconds !== recordedMinutes * 60) {
    throw invalidArgument(`${label}.recordedDurationSeconds must equal recordedMinutes * 60`);
  }
  return {
    id,
    gameId,
    startTime,
    endTime,
    sourceDate: isoDate(value.sourceDate, `${label}.sourceDate`),
    recordedMinutes,
    recordedDurationSeconds,
    durationPrecision: 'minute-rounded',
    trackingMode: 'unknown',
    recordKind: 'unknown',
  };
}

function validatePlayStats(value: unknown, label: string, sessions: ReinaSession[]): ReinaPlaySnapshot['stats'] {
  assertRecord(value, label);
  assertNoUnexpectedKeys(value, [
    'sourceTotalMinutes',
    'sourceSessionCount',
    'sourceLastPlayed',
    'sessionTotalMinutes',
    'sessionCount',
    'liveSession',
  ], label);
  if (value.liveSession !== false) throw invalidArgument(`${label}.liveSession must be false`);
  const sourceTotalMinutes = value.sourceTotalMinutes === null
    ? null
    : numberInRange(value.sourceTotalMinutes, `${label}.sourceTotalMinutes`, 0, 100_000_000, true);
  const sourceSessionCount = value.sourceSessionCount === null
    ? null
    : numberInRange(value.sourceSessionCount, `${label}.sourceSessionCount`, 0, 1_000_000, true);
  const sourceLastPlayed = value.sourceLastPlayed === null ? null : isoDateTimeOrDate(value.sourceLastPlayed, `${label}.sourceLastPlayed`);
  const sessionTotalMinutes = numberInRange(value.sessionTotalMinutes, `${label}.sessionTotalMinutes`, 0, 100_000_000, true);
  const sessionCount = numberInRange(value.sessionCount, `${label}.sessionCount`, 0, MAX_PLAY_SESSION_CARD_SESSIONS, true);
  const expectedTotal = sessions.reduce((total, session) => total + session.recordedMinutes, 0);
  if (!Number.isSafeInteger(expectedTotal)) throw invalidArgument(`${label}.sessionTotalMinutes is not a safe integer`);
  if (sessionCount !== sessions.length) throw invalidArgument(`${label}.sessionCount must match snapshot.sessions`);
  if (sessionTotalMinutes !== expectedTotal) throw invalidArgument(`${label}.sessionTotalMinutes must match snapshot.sessions`);
  return {
    sourceTotalMinutes,
    sourceSessionCount,
    sourceLastPlayed,
    sessionTotalMinutes,
    sessionCount,
    liveSession: false,
  };
}

function validatePlaySnapshot(value: unknown, label: string): ReinaPlaySnapshot {
  assertRecord(value, label);
  assertNoUnexpectedKeys(value, [
    'version',
    'sourceApp',
    'sourceId',
    'externalGameId',
    'externalGameName',
    'fetchedAt',
    'sessions',
    'stats',
  ], label);
  if (value.version !== 1) throw invalidArgument(`${label}.version must be 1`);
  if (value.sourceApp !== 'ReinaManager') throw invalidArgument(`${label}.sourceApp is invalid`);
  const externalGameId = numberInRange(value.externalGameId, `${label}.externalGameId`, 1, Number.MAX_SAFE_INTEGER, true);
  if (!Array.isArray(value.sessions)) throw invalidArgument(`${label}.sessions must be an array`);
  if (value.sessions.length > MAX_PLAY_SESSION_CARD_SESSIONS) {
    throw invalidArgument(`${label}.sessions must contain at most ${MAX_PLAY_SESSION_CARD_SESSIONS} sessions`);
  }
  const seenIds = new Set<number>();
  const sessions = value.sessions.map((session, index) => validatePlaySession(session, `${label}.sessions[${index}]`, externalGameId, seenIds));
  return {
    version: 1,
    sourceApp: 'ReinaManager',
    sourceId: text(value.sourceId, `${label}.sourceId`, 120),
    externalGameId,
    externalGameName: text(value.externalGameName, `${label}.externalGameName`, 300),
    fetchedAt: isoDateTime(value.fetchedAt, `${label}.fetchedAt`),
    sessions,
    stats: validatePlayStats(value.stats, `${label}.stats`, sessions),
  };
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

  if (value.type === 'play-session') {
    assertNoUnexpectedKeys(value, ['type', 'id', 'x', 'y', 'width', 'height', 'rotation', 'zIndex', 'locked', 'snapshot'], label);
    if (typeof value.locked !== 'boolean') throw invalidArgument(`${label}.locked must be a boolean`);
    return {
      type: 'play-session',
      ...validateFrame(value, label),
      snapshot: validatePlaySnapshot(value.snapshot, `${label}.snapshot`),
    } satisfies JournalPlaySessionBlock;
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
