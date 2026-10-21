import type {
  ReinaPlaySnapshot,
  ReinaSession,
  ReinaStats,
} from '../../../../shared/reina';

/** Insertion cap enforced by both the picker and the main-process validator. */
export const MAX_PLAY_SESSION_CARD_SESSIONS = 20;
/** Reina session page size used by the journal picker. */
export const PLAY_SESSION_QUERY_LIMIT = 20;

const ISO_DATE_TIME_PARTS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/;
/** Length of each month in a non-leap year; February is handled separately. */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  const daysInMonth = month === 2 && isLeapYear(year) ? 29 : MONTH_DAYS[month - 1];
  return day >= 1 && day <= daysInMonth;
}

/** Mirrors the main-process check, so a snapshot is never built from a normalized date. */
export function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  const parts = ISO_DATE_TIME_PARTS.exec(value);
  if (!parts) return false;
  if (!isRealCalendarDate(Number(parts[1]), Number(parts[2]), Number(parts[3]))) return false;
  if (Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59) return false;
  if (parts[8] !== undefined && (Number(parts[8]) > 23 || Number(parts[9]) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReinaSessionValue(value: unknown): value is ReinaSession {
  if (!isRecord(value)) return false;
  return typeof value.id === 'number' && Number.isSafeInteger(value.id) && value.id > 0
    && typeof value.gameId === 'number' && Number.isSafeInteger(value.gameId) && value.gameId > 0
    && typeof value.startTime === 'string'
    && typeof value.endTime === 'string'
    && typeof value.sourceDate === 'string'
    && typeof value.recordedMinutes === 'number' && Number.isFinite(value.recordedMinutes)
    && typeof value.recordedDurationSeconds === 'number' && Number.isFinite(value.recordedDurationSeconds);
}

/** Epoch milliseconds, or NaN when the stored timestamp cannot be parsed. */
function parseTimestamp(iso: string): number {
  const epoch = Date.parse(iso);
  return Number.isFinite(epoch) ? epoch : Number.NaN;
}

/**
 * Newest sessions first by absolute time (epoch), not by raw string, so records
 * written with different UTC offsets stay chronological. Ties fall back to the
 * source's session_id DESC order; labels keep each record's own wall clock and
 * source date, so display never shifts a session into another timezone.
 */
export function sortPlaySessions(sessions: readonly ReinaSession[]): ReinaSession[] {
  return [...sessions].sort((left, right) => {
    const leftEpoch = parseTimestamp(left.startTime);
    const rightEpoch = parseTimestamp(right.startTime);
    if (Number.isFinite(leftEpoch) && Number.isFinite(rightEpoch)) {
      if (leftEpoch !== rightEpoch) return rightEpoch - leftEpoch;
      return right.id - left.id;
    }
    const byText = right.startTime.localeCompare(left.startTime);
    if (byText !== 0) return byText;
    return right.id - left.id;
  });
}

export function mergePlaySessions(current: readonly ReinaSession[], incoming: readonly ReinaSession[]): ReinaSession[] {
  const byId = new Map<number, ReinaSession>();
  for (const session of current) byId.set(session.id, session);
  for (const session of incoming) byId.set(session.id, session);
  return sortPlaySessions([...byId.values()]);
}

/** Deduplicate, sort newest-first and cap the selection at the card limit. */
export function clampPlaySessions(sessions: readonly ReinaSession[]): ReinaSession[] {
  const seen = new Set<number>();
  const unique: ReinaSession[] = [];
  for (const session of sortPlaySessions(sessions)) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    unique.push({ ...session });
    if (unique.length >= MAX_PLAY_SESSION_CARD_SESSIONS) break;
  }
  return unique;
}

export function pickPlaySessions(sessions: readonly ReinaSession[], selectedIds: ReadonlySet<number>): ReinaSession[] {
  return clampPlaySessions(sessions.filter((session) => selectedIds.has(session.id)));
}

/** Sum of recorded play minutes only; music durations are never part of this value. */
export function sumPlayMinutes(sessions: readonly ReinaSession[]): number {
  let total = 0;
  for (const session of sessions) {
    const minutes = session.recordedMinutes;
    if (!Number.isSafeInteger(minutes) || minutes < 1) {
      throw new Error('游玩记录分钟数无效');
    }
    total += minutes;
    if (!Number.isSafeInteger(total)) throw new Error('游玩时长超出可记录范围');
  }
  return total;
}

/**
 * A card entry must be a positive whole number of minutes, exactly matched by
 * its second count, with a non-empty positive range — the same rules the
 * main-process validator enforces on save.
 */
export function isInsertablePlaySession(session: ReinaSession): boolean {
  if (!Number.isSafeInteger(session.recordedMinutes) || session.recordedMinutes < 1) return false;
  if (session.recordedDurationSeconds !== session.recordedMinutes * 60) return false;
  const start = parseTimestamp(session.startTime);
  const end = parseTimestamp(session.endTime);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

export interface BuildPlaySnapshotInput {
  sourceId: string;
  externalGameId: number;
  externalGameName: string;
  fetchedAt: string;
  sessions: readonly ReinaSession[];
  /** Source lifetime statistics; per-snapshot counters are rebuilt from `sessions`. */
  stats: ReinaStats;
}

/**
 * Build the frozen snapshot stored on a card.
 *
 * `sessionCount` / `sessionTotalMinutes` are derived from the selected play
 * sessions so an inserted card can never inherit the source's unrelated music
 * or library totals. Source lifetime fields are labelled separately.
 */
export function buildPlaySnapshot(input: BuildPlaySnapshotInput): ReinaPlaySnapshot {
  if (!isIsoDateTime(input.fetchedAt)) throw new Error('快照时间无效');
  if (!Number.isSafeInteger(input.externalGameId) || input.externalGameId < 1) throw new Error('外部作品 ID 无效');
  const sessions = clampPlaySessions(input.sessions);
  for (const session of sessions) {
    if (session.gameId !== input.externalGameId) throw new Error('游玩记录与外部作品不一致');
    if (!isInsertablePlaySession(session)) throw new Error('游玩记录时长无效');
  }
  return {
    version: 1,
    sourceApp: 'ReinaManager',
    sourceId: input.sourceId,
    externalGameId: input.externalGameId,
    externalGameName: input.externalGameName,
    fetchedAt: input.fetchedAt,
    sessions,
    stats: {
      sourceTotalMinutes: input.stats.sourceTotalMinutes,
      sourceSessionCount: input.stats.sourceSessionCount,
      sourceLastPlayed: input.stats.sourceLastPlayed,
      sessionTotalMinutes: sumPlayMinutes(sessions),
      sessionCount: sessions.length,
      liveSession: false,
    },
  };
}

export function clonePlaySnapshot(snapshot: ReinaPlaySnapshot): ReinaPlaySnapshot {
  return {
    ...snapshot,
    sessions: snapshot.sessions.map((session) => ({ ...session })),
    stats: { ...snapshot.stats },
  };
}

function readNullableNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Accept the documented `ReinaStats` payload, plus a defensive `{ stats }`
 * wrapper, and rebuild a complete object for the picker header.
 */
export function readPlayStats(data: unknown): ReinaStats {
  const candidate = isRecord(data) && isRecord(data.stats) ? data.stats : data;
  if (!isRecord(candidate)) throw new Error('游玩统计格式无法识别');
  const sourceTotalMinutes = readNullableNumber(candidate.sourceTotalMinutes);
  const sourceSessionCount = readNullableNumber(candidate.sourceSessionCount);
  const sourceLastPlayed = candidate.sourceLastPlayed === null
    ? null
    : typeof candidate.sourceLastPlayed === 'string' ? candidate.sourceLastPlayed : undefined;
  const sessionTotalMinutes = typeof candidate.sessionTotalMinutes === 'number' && Number.isFinite(candidate.sessionTotalMinutes)
    ? candidate.sessionTotalMinutes
    : undefined;
  const sessionCount = typeof candidate.sessionCount === 'number' && Number.isFinite(candidate.sessionCount)
    ? candidate.sessionCount
    : undefined;
  if (sourceTotalMinutes === undefined || sourceSessionCount === undefined || sourceLastPlayed === undefined || sessionTotalMinutes === undefined || sessionCount === undefined) {
    throw new Error('游玩统计格式无法识别');
  }
  return { sourceTotalMinutes, sourceSessionCount, sourceLastPlayed, sessionTotalMinutes, sessionCount, liveSession: false };
}

/** Accept the documented `ReinaSession[]` payload, plus a defensive `{ sessions }` wrapper. */
export function readPlaySessionList(data: unknown): ReinaSession[] {
  const list = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.sessions) ? data.sessions : null;
  if (!list) throw new Error('游玩记录数据格式无法识别');
  const sessions = list.filter(isReinaSessionValue);
  if (sessions.length !== list.length) throw new Error('游玩记录数据格式无法识别');
  return sessions;
}

export function formatPlayMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '0 分钟';
  const whole = Math.floor(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest} 分钟`;
  if (rest === 0) return `${hours} 小时`;
  return `${hours} 小时 ${rest} 分钟`;
}

/** The recorded wall-clock time inside an ISO timestamp (no timezone conversion). */
export function formatPlayClock(iso: string): string {
  const match = /T(\d{2}:\d{2})/.exec(iso);
  return match?.[1] ?? '';
}

/** The record's own calendar day (source `sourceDate`), never converted between timezones. */
export function formatPlayDate(session: ReinaSession): string {
  return session.sourceDate || session.startTime.slice(0, 10);
}

export function formatPlaySessionRange(session: ReinaSession): string {
  const start = formatPlayClock(session.startTime);
  const end = formatPlayClock(session.endTime);
  if (start && end) return `${start}–${end}`;
  return start || end;
}

export function formatSnapshotFetchedAt(iso: string): string {
  const date = iso.slice(0, 10);
  const clock = formatPlayClock(iso);
  return clock ? `${date} ${clock}` : date;
}

export function describePlaySnapshot(snapshot: ReinaPlaySnapshot): string {
  return `${snapshot.externalGameName} · ${snapshot.stats.sessionCount} 次 · ${formatPlayMinutes(snapshot.stats.sessionTotalMinutes)} · 截至 ${formatSnapshotFetchedAt(snapshot.fetchedAt)}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
