import { randomUUID } from 'node:crypto';
import type { ReinaConnection, ReinaEnvelope, ReinaGame, ReinaQuery, ReinaSession, ReinaStats, ReinaTag, ReinaTool } from '../../shared/reina';
import { validateReinaQuery } from './validation';
import { reinaError } from './errors';
type SourceStats = Pick<ReinaStats, 'sourceTotalMinutes' | 'sourceSessionCount' | 'sourceLastPlayed'>;
export interface ReinaReader {
  connection(): ReinaConnection; games(): ReinaGame[];
  snapshot(gameId: number, from?: string, to?: string): { sessions: ReinaSession[]; stats: SourceStats };
  close(): void;
}
interface Snapshot {
  id: string; sourceId: string; path: string; scope: string; created: number; fetchedAt: string; bytes: number;
  rows: ReinaGame[] | ReinaSession[] | ReinaTag[]; stats?: ReinaStats; warnings: string[];
  gameId?: number; from?: string; to?: string;
  cursors: Map<string, { offset: number; tool: ReinaTool }>;
}
export class ReinaQueryEngine {
  private snapshots = new Map<string, Snapshot>();
  constructor(private readonly open: (path: string) => ReinaReader) {}
  invalidate(sourceId: string): void { for (const [id, snap] of this.snapshots) if (snap.sourceId === sourceId) this.snapshots.delete(id); }
  private prune(): void { for (const [id, snap] of this.snapshots) if (Date.now() - snap.created >= 300000) this.snapshots.delete(id); }
  call(path: string, rawTool: unknown, rawQuery: unknown, expectedExternalIds?: string): ReinaEnvelope {
    const { tool, query } = validateReinaQuery(rawTool, rawQuery);
    this.prune();
    if (expectedExternalIds && query.gameId) {
      const reader = this.open(path);
      try {
        const game = reader.games().find(item => item.id === query.gameId);
        if (!game || JSON.stringify([...game.externalIds].sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id))) !== expectedExternalIds) throw new Error('作品资料编号已改变，请解绑并重新确认关联。');
      } finally { reader.close(); }
    }
    if (tool === 'reina_get_connection') {
      const reader = this.open(path);
      try { return this.envelope(query.sourceId, null, new Date().toISOString(), reader.connection()); } finally { reader.close(); }
    }
    const scope = JSON.stringify(tool === 'reina_list_games' ? ['games', query.query ?? '', query.provider ?? '', query.externalId ?? ''] : [tool === 'reina_get_tags' ? 'tags' : 'sessions', query.gameId, query.from ?? '', query.to ?? '']);
    let snap: Snapshot | undefined;
    let offset = 0;
    if (query.cursor) {
      snap = [...this.snapshots.values()].find(item => item.cursors.has(query.cursor!));
      const cursor = snap?.cursors.get(query.cursor);
      if (!cursor || cursor.tool !== tool || (query.snapshotId && query.snapshotId !== snap?.id)) throw new Error('分页已失效，请刷新游玩记录。');
      offset = cursor.offset;
    } else if (query.snapshotId) snap = this.snapshots.get(query.snapshotId);
    if (query.cursor || query.snapshotId) {
      if (!snap || snap.sourceId !== query.sourceId || snap.path !== path) throw new Error('快照已失效或与当前作品不符，请刷新。');
      if (snap.scope !== scope && !(tool === 'reina_get_stats' && snap.stats && snap.gameId === query.gameId && covers(snap, query))) throw reinaError('INVALID_INPUT');
    }
    if (!snap) snap = this.create(path, tool, query, scope);
    const limit = query.limit ?? 50;
    const data = tool === 'reina_get_stats' ? statsFor(snap.stats!, (snap.rows as ReinaSession[]).filter(row => (!query.from || Date.parse(row.startTime) >= Date.parse(query.from)) && (!query.to || Date.parse(row.startTime) < Date.parse(query.to)))) : snap.rows.slice(offset, offset + limit);
    const warnings = tool === 'reina_get_stats' && (query.from || query.to) ? snap.warnings.filter(warning => !warning.includes('不一致')) : snap.warnings;
    let nextCursor: string | null = null;
    if (tool !== 'reina_get_stats' && offset + limit < snap.rows.length) {
      // Repeated identical pagination does not grow cursor storage without bound.
      nextCursor = [...snap.cursors].find(([, value]) => value.tool === tool && value.offset === offset + limit)?.[0] ?? randomUUID();
      snap.cursors.set(nextCursor, { tool, offset: offset + limit });
    }
    return this.envelope(query.sourceId, snap.id, snap.fetchedAt, data, nextCursor, warnings);
  }
  private create(path: string, tool: ReinaTool, query: ReinaQuery, scope: string): Snapshot {
    const reader = this.open(path);
    let rows: Snapshot['rows']; let stats: ReinaStats | undefined;
    try {
      if (query.gameId && !reader.games().some(game => game.id === query.gameId)) throw reinaError('INVALID_INPUT');
      if (tool === 'reina_list_games') rows = reader.games().filter(game => (!query.query || game.name.toLocaleLowerCase().includes(query.query.toLocaleLowerCase())) && (!query.externalId || game.externalIds.some(id => id.provider === query.provider && id.id === query.externalId)));
      else if (tool === 'reina_get_tags') rows = reader.games().find(game => game.id === query.gameId)?.tags ?? [];
      else {
        const result = reader.snapshot(query.gameId!, query.from, query.to);
        rows = result.sessions;
        stats = statsFor(result.stats, rows);
      }
    } finally { reader.close(); }
    const warnings: string[] = [];
    if (stats) {
      if (stats.sourceTotalMinutes === null || stats.sourceSessionCount === null || stats.sourceLastPlayed === null) warnings.push('来源统计存在缺失值；会话合计与来源累计分别展示。');
      if (!query.from && !query.to && ((stats.sourceTotalMinutes !== null && stats.sourceTotalMinutes !== stats.sessionTotalMinutes) || (stats.sourceSessionCount !== null && stats.sourceSessionCount !== stats.sessionCount))) warnings.push('来源累计与已保存会话合计不一致，可能有历史修正或缺失记录；未自动覆盖来源统计。');
    }
    if (tool === 'reina_list_games' && (rows as ReinaGame[]).some(game => game.unsupportedTagProviders.length > 0)) warnings.push('部分作品包含尚未支持的标签来源，已保留诊断并跳过这些标签。');
    const bytes = Buffer.byteLength(JSON.stringify({ rows, stats }), 'utf8');
    if (rows.length > 50000 || bytes > 16 * 1024 * 1024) throw new Error('记录超过单次快照上限，请缩小查询范围。');
    while (this.snapshots.size >= 4 || [...this.snapshots.values()].reduce((total, item) => total + item.bytes, 0) + bytes > 64 * 1024 * 1024) this.snapshots.delete(this.snapshots.keys().next().value!);
    const snap: Snapshot = { id: randomUUID(), sourceId: query.sourceId, path, scope, created: Date.now(), fetchedAt: new Date().toISOString(), bytes, rows, stats, warnings, gameId: query.gameId, from: query.from, to: query.to, cursors: new Map() };
    this.snapshots.set(snap.id, snap); return snap;
  }
  private envelope(sourceId: string, snapshotId: string | null, fetchedAt: string, data: unknown, nextCursor: string | null = null, warnings: string[] = []): ReinaEnvelope {
    return { contractVersion: 1, sourceApp: 'ReinaManager', sourceId, snapshotId, fetchedAt, warnings: ['仅包含已保存的游玩记录；历史计时模式未知。', '时长为来源四舍五入后的分钟；范围按开始时间筛选，不截断会话。', ...warnings], data, nextCursor };
  }
}

function covers(snapshot: Snapshot, query: ReinaQuery): boolean {
  return (!snapshot.from || Boolean(query.from && Date.parse(query.from) >= Date.parse(snapshot.from))) && (!snapshot.to || Boolean(query.to && Date.parse(query.to) <= Date.parse(snapshot.to)));
}

function statsFor(source: SourceStats, rows: ReinaSession[]): ReinaStats {
  const sessionTotalMinutes = rows.reduce((total, row) => total + row.recordedMinutes, 0);
  if (!Number.isSafeInteger(sessionTotalMinutes)) throw reinaError('DATA_LIMIT_EXCEEDED');
  const latest = rows.reduce((value, row) => Math.max(value, Date.parse(row.endTime)), -Infinity);
  return { ...source, sessionTotalMinutes, sessionCount: rows.length, sessionLastPlayed: Number.isFinite(latest) ? new Date(latest).toISOString() : null, liveSession: false };
}
