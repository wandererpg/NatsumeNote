import type { ReinaProvider } from '../../../../shared/reina';

const PROVIDER_LABELS: Partial<Record<ReinaProvider, string>> = {
  vndb: 'VNDB',
  bangumi: 'Bangumi',
  custom: '自定义',
};

export function providerLabel(provider: ReinaProvider | string): string {
  const label = PROVIDER_LABELS[provider as ReinaProvider];
  return label ?? String(provider);
}

/**
 * Durations come from the source as rounded minutes (`durationPrecision:
 * "minute-rounded"`). Never invent seconds or sub-minute precision here.
 */
export function formatMinutes(minutes: number | null | undefined, fallback = '来源未提供'): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return fallback;
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} 分钟`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分钟`;
}

export function formatSessionCount(count: number | null | undefined, fallback = '来源未提供'): string {
  if (count === null || count === undefined || !Number.isFinite(count)) return fallback;
  return `${Math.max(0, Math.round(count))} 次`;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** Render an ISO timestamp in local time, minute precision only. */
export function formatDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatSessionRange(startTime: string, endTime: string): string {
  const start = formatDateTime(startTime);
  const end = formatDateTime(endTime);
  if (!start && !end) return '时间无法解析';
  if (!end) return start as string;
  if (!start) return end;
  const sameDay = start.slice(0, 10) === end.slice(0, 10);
  return sameDay
    ? `${start.slice(0, 10)} ${start.slice(11)}–${end.slice(11)}`
    : `${start} – ${end}`;
}

/** The source keeps its own dates; only fall back when the value is malformed. */
export function formatSourceDate(value: string | null | undefined): string {
  if (!value) return '来源日期未知';
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : (formatDateTime(value) ?? value);
}

export function trackingModeLabel(mode: string): string {
  return mode === 'unknown' ? '计时方式未知' : `计时方式：${mode}`;
}

export function durationPrecisionLabel(precision: string): string {
  return precision === 'minute-rounded' ? '分钟精度' : `精度：${precision}`;
}

function parseDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  if (year < 1000 || year > 9999) return null;
  const value = new Date(year, month - 1, date);
  if (
    value.getFullYear() !== year
    || value.getMonth() !== month - 1
    || value.getDate() !== date
  ) {
    return null;
  }
  return value;
}

/** Start of the picked local day as an ISO timestamp (`from` boundary). */
export function dayStartIso(day: string): string | null {
  const value = parseDay(day);
  return value ? value.toISOString() : null;
}

/** Start of the following local day, used as the exclusive `to` boundary. */
export function nextDayStartIso(day: string): string | null {
  const value = parseDay(day);
  if (!value) return null;
  const next = new Date(value.getFullYear(), value.getMonth(), value.getDate() + 1);
  return next.toISOString();
}
