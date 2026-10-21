/** Read-only ReinaManager bridge. All durations preserve the source's rounded minutes. */
export type ReinaProvider = 'vndb' | 'bangumi' | 'custom';
export interface ReinaTag { name: string; provider: ReinaProvider }
export const reinaTagKey = (tag: ReinaTag): string => `${tag.provider}:${tag.name.trim()}`;
export interface ReinaGame { id: number; name: string; externalIds: { provider: 'vndb' | 'bangumi'; id: string }[]; tags: ReinaTag[]; unsupportedTagProviders: string[] }
export interface ReinaSession { id: number; gameId: number; startTime: string; endTime: string; sourceDate: string; recordedMinutes: number; recordedDurationSeconds: number; durationPrecision: 'minute-rounded'; trackingMode: 'unknown'; recordKind: 'unknown' }
export interface ReinaStats { sourceTotalMinutes: number | null; sourceSessionCount: number | null; sourceLastPlayed: string | null; sessionTotalMinutes: number; sessionCount: number; sessionLastPlayed?: string | null; liveSession: false }
export interface ReinaConnection { schemaProfile: string; readable: true; liveSession: false }
export interface ReinaEnvelope<T = unknown> { contractVersion: 1; sourceApp: 'ReinaManager'; sourceId: string; snapshotId: string | null; fetchedAt: string; warnings: string[]; data: T; nextCursor: string | null }
export type ReinaTool = 'reina_get_connection' | 'reina_list_games' | 'reina_list_sessions' | 'reina_get_stats' | 'reina_get_tags';
export interface ReinaQuery { sourceId: string; gameId?: number; query?: string; externalId?: string; provider?: 'vndb' | 'bangumi'; from?: string; to?: string; limit?: number; cursor?: string; snapshotId?: string }
export interface ReinaSource { id: string; label: string; connectedAt: string }
export interface ReinaLink { localGameId: string; sourceId: string; externalGameId: number; externalName: string; needsConfirmation?: boolean }
export interface ReinaPlaySnapshot { version: 1; sourceApp: 'ReinaManager'; sourceId: string; externalGameId: number; externalGameName: string; fetchedAt: string; sessions: ReinaSession[]; stats: ReinaStats }
export interface GameTagFilter { tags: string[] }
export const REINA_CHANNELS = {
  batchPreview: 'reina:batch-preview', batchApply: 'reina:batch-apply',
  sources: 'reina:sources', connect: 'reina:connect', disconnect: 'reina:disconnect',
  query: 'reina:query', links: 'reina:links', bind: 'reina:bind', unbind: 'reina:unbind',
  filterGames: 'library:filter-games-by-tags', tags: 'library:game-tags',
} as const;
export interface ReinaAPI {
  reinaBatchPreview?: (sourceId: string) => Promise<ReinaBatchPreview>;
  reinaBatchApply?: (token: string, decisions: ReinaBatchDecision[]) => Promise<ReinaBatchResult>;
  reinaSources?: () => Promise<ReinaSource[]>;
  reinaConnect?: () => Promise<ReinaSource | null>;
  reinaDisconnect?: (sourceId: string) => Promise<void>;
  reinaQuery?: <T = unknown>(tool: ReinaTool, query: ReinaQuery) => Promise<ReinaEnvelope<T>>;
  reinaLinks?: (localGameId: string) => Promise<ReinaLink[]>;
  reinaBind?: (link: ReinaLink) => Promise<void>;
  reinaUnbind?: (localGameId: string, sourceId: string) => Promise<void>;
  filterGamesByTags?: (tags: string[]) => Promise<import('./types').Game[]>;
  getGameTags?: (localGameId?: string) => Promise<ReinaTag[]>;
}

export interface ReinaBatchDecision {
  externalGameId: number;
  action: 'link' | 'create' | 'skip' | 'review';
  localGameId?: string;
}
export interface ReinaBatchRow extends ReinaBatchDecision {
  name: string;
  reason: string;
  newName?: string;
  alreadyLinked: boolean;
}
export interface ReinaBatchPreview {
  token: string;
  libraryPath: string;
  rows: ReinaBatchRow[];
  localGames: { id: string; name: string; boundExternalGameId?: number }[];
  warnings: string[];
}
export interface ReinaBatchResult { created: number; linked: number; skipped: number }
