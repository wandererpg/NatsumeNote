import { AppError, isAppError } from '../../shared/errors';
import { detectSummaryLanguage } from '../../shared/summary-language';

export interface SummaryTranslationHttpClient {
  fetch(url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

const PROVIDER_URL = 'https://api.mymemory.translated.net/get';
const PROVIDER_SEGMENT_BYTES = 480;

function defaultHttpClient(): SummaryTranslationHttpClient {
  return {
    async fetch(url, init) {
      const response = await fetch(url, init);
      return {
        ok: response.ok,
        status: response.status,
        json: () => response.json(),
      };
    },
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function splitOversizedUnit(unit: string): string[] {
  const segments: string[] = [];
  let current = '';
  for (const character of unit) {
    if (current && byteLength(current + character) > PROVIDER_SEGMENT_BYTES) {
      segments.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) segments.push(current);
  return segments;
}

/** MyMemory limits q to 500 UTF-8 bytes, so pack words below that boundary. */
export function splitSummaryForTranslation(text: string): string[] {
  const units = text.replace(/\r\n?/gu, '\n').trim().match(/\S+\s*|\s+/gu) ?? [];
  const segments: string[] = [];
  let current = '';
  const flush = () => {
    const value = current.trim();
    if (value) segments.push(value);
    current = '';
  };

  for (const unit of units) {
    if (byteLength(unit) > PROVIDER_SEGMENT_BYTES) {
      flush();
      for (const part of splitOversizedUnit(unit)) {
        const value = part.trim();
        if (value) segments.push(value);
      }
    } else if (current && byteLength(current + unit) > PROVIDER_SEGMENT_BYTES) {
      flush();
      current = unit;
    } else {
      current += unit;
    }
  }
  flush();
  return segments;
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>' };
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|apos|quot|lt|gt));/giu, (entity, decimal: string | undefined, hexadecimal: string | undefined, name: string | undefined) => {
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
    return name ? named[name.toLowerCase()] ?? entity : entity;
  });
}

function translatedText(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const responseData = (payload as { responseData?: unknown }).responseData;
  if (typeof responseData !== 'object' || responseData === null) return null;
  const value = (responseData as { translatedText?: unknown }).translatedText;
  return typeof value === 'string' && value.trim() ? decodeEntities(value.trim()) : null;
}

function providerStatus(payload: unknown): number {
  if (typeof payload !== 'object' || payload === null) return 500;
  const value = (payload as { responseStatus?: unknown }).responseStatus;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : 200;
  return Number.isFinite(parsed) ? parsed : 500;
}

export async function translateSummaryToChinese(
  text: string,
  signal: AbortSignal,
  http: SummaryTranslationHttpClient = defaultHttpClient(),
): Promise<string> {
  const normalized = text.trim();
  if (!normalized) throw new AppError('DB_ERROR', 'Summary is empty', '没有可翻译的作品简介。');
  const language = detectSummaryLanguage(normalized);
  if (language === 'zh-CN') return normalized;

  const output: string[] = [];
  try {
    for (const segment of splitSummaryForTranslation(normalized)) {
      const url = new URL(PROVIDER_URL);
      url.searchParams.set('q', segment);
      url.searchParams.set('langpair', `${language}|zh-CN`);
      url.searchParams.set('mt', '1');
      const response = await http.fetch(url.toString(), {
        signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new AppError('DB_ERROR', `Translation provider returned HTTP ${response.status}`, '在线翻译暂时不可用，请稍后重试。');
      }
      const payload = await response.json();
      const status = providerStatus(payload);
      if (status === 403 || status === 429) {
        throw new AppError('DB_ERROR', `Translation quota unavailable (${status})`, '今日免费翻译额度已用完，请稍后再试。');
      }
      if (status >= 400) {
        throw new AppError('DB_ERROR', `Translation provider rejected the request (${status})`, '在线翻译暂时不可用，请稍后重试。');
      }
      const value = translatedText(payload);
      if (!value) throw new AppError('DB_ERROR', 'Translation provider returned no text', '翻译服务没有返回有效译文，请稍后重试。');
      output.push(value);
    }
  } catch (error) {
    if (signal.aborted || isAppError(error)) throw error;
    throw new AppError('DB_ERROR', 'Summary translation request failed', '无法连接在线翻译服务，请检查网络后重试。', { cause: error });
  }
  return output.join('\n\n');
}
