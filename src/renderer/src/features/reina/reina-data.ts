import type { ReinaGame, ReinaSession, ReinaStats } from '../../../../shared/reina';

/**
 * The renderer contract fixes the envelope but leaves each tool's `data` payload
 * shape to the main process implementation. These readers accept either a bare
 * array/object or a `{ games }` / `{ sessions }` / `{ stats }` wrapper, and never
 * invent values for missing fields.
 */
export function asReinaList<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data !== null && typeof data === 'object') {
    const wrapped = (data as Record<string, unknown>)[key];
    if (Array.isArray(wrapped)) return wrapped as T[];
  }
  return [];
}

export function asReinaStats(data: unknown): ReinaStats | null {
  if (data === null || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (typeof record.sessionTotalMinutes === 'number') return data as ReinaStats;
  const nested = record.stats;
  if (
    nested !== null
    && typeof nested === 'object'
    && typeof (nested as Record<string, unknown>).sessionTotalMinutes === 'number'
  ) {
    return nested as ReinaStats;
  }
  return null;
}

export function mergeWarnings(...groups: Array<string[] | null | undefined>): string[] {
  const merged: string[] = [];
  for (const group of groups) {
    for (const warning of group ?? []) {
      if (typeof warning !== 'string') continue;
      const text = warning.trim();
      if (text !== '' && !merged.includes(text)) merged.push(text);
    }
  }
  return merged;
}

export function mergeSessions(current: ReinaSession[], incoming: ReinaSession[]): ReinaSession[] {
  const seen = new Set(current.map((session) => session.id));
  const merged = [...current];
  for (const session of incoming) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    merged.push(session);
  }
  return merged;
}

export function mergeGames(current: ReinaGame[], incoming: ReinaGame[]): ReinaGame[] {
  const seen = new Set(current.map((game) => game.id));
  const merged = [...current];
  for (const game of incoming) {
    if (seen.has(game.id)) continue;
    seen.add(game.id);
    merged.push(game);
  }
  return merged;
}
