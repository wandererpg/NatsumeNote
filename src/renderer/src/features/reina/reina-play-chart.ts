import type { ReinaSession } from '../../../../shared/reina';

export interface DailyPlayPoint {
  /** A local calendar date represented as an ordinal day (without DST offsets). */
  day: number;
  date: string;
  minutes: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FILLED_DAYS = 3660;

function localCalendarDay(value: string): number | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  return calendarDate.getTime() / DAY_MS;
}

export function playDayLabel(day: number, includeYear = false): string {
  const date = new Date(day * DAY_MS);
  const monthDay = `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  return includeYear ? `${date.getUTCFullYear()}/${monthDay}` : monthDay;
}

function point(day: number, minutes: number): DailyPlayPoint {
  const date = new Date(day * DAY_MS);
  return {
    day,
    date: [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-'),
    minutes,
  };
}

/** Use the saved minutes, assigning a session to its local start date. */
export function buildDailyPlayData(sessions: readonly ReinaSession[]): DailyPlayPoint[] {
  const totals = new Map<number, number>();
  for (const session of sessions) {
    const day = localCalendarDay(session.startTime);
    if (day === null || !Number.isFinite(session.recordedMinutes) || session.recordedMinutes < 0) continue;
    totals.set(day, (totals.get(day) ?? 0) + session.recordedMinutes);
  }
  const days = [...totals.keys()].sort((a, b) => a - b);
  if (!days.length) return [];
  const first = days[0];
  const last = days[days.length - 1];
  if (last - first < MAX_FILLED_DAYS) {
    return Array.from({ length: last - first + 1 }, (_, index) => {
      const day = first + index;
      return point(day, totals.get(day) ?? 0);
    });
  }

  // Keep long empty spans proportional on the time axis without allocating
  // thousands of empty days. Both gap edges are zero, so the line stays at zero.
  const result: DailyPlayPoint[] = [];
  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    const previous = days[index - 1];
    if (index > 0 && day - previous > 1) {
      result.push(point(previous + 1, 0));
      if (day - previous > 2) result.push(point(day - 1, 0));
    }
    result.push(point(day, totals.get(day) ?? 0));
  }
  return result;
}
