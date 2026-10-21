import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import type { ReinaEnvelope, ReinaGame, ReinaLink, ReinaQuery, ReinaSource, ReinaTag, ReinaTool } from '../../shared/reina';
import { createReinaMcp } from './mcp';
import { fileIdentity } from './file-identity';
import { validateReinaQuery } from './validation';
import { filterIndexedGames, listIndexedTags, replaceExternalTags } from './tag-index';
interface SourceRow { id: string; label: string; authorized_path: string; file_identity: string; connected_at: string }
interface LinkRow { local_game_id: string; source_id: string; external_game_id: number; external_name: string; external_ids_json: string; needs_confirmation: number }
export interface ReinaExecutor {
  call(path: string, identity: string, tool: ReinaTool, query: ReinaQuery, expectedExternalIds?: string): Promise<ReinaEnvelope>;
  invalidate(sourceId: string): void;
  suspend?(): void;
  close(): void;
}
const publicSource = (row: SourceRow): ReinaSource => ({ id: row.id, label: row.label, connectedAt: row.connected_at });
const publicLink = (row: LinkRow): ReinaLink => ({ localGameId: row.local_game_id, sourceId: row.source_id, externalGameId: row.external_game_id, externalName: row.external_name, ...(row.needs_confirmation ? { needsConfirmation: true } : {}) });
export class ReinaService {
  private readonly mcp: ReturnType<typeof createReinaMcp>;
  private provisional = new Map<string, SourceRow>();
  private previews = new Map<string, { identity: string; created: number }>();
  private closed = false;
  constructor(private readonly db: Database.Database, private readonly executor: ReinaExecutor) {
    this.mcp = createReinaMcp(async (tool, query) => {
      const source = this.source(query.sourceId);
      this.verifyIdentity(source);
      const link = query.gameId ? this.db.prepare('SELECT * FROM external_game_links WHERE source_id=? AND external_game_id=?').get(source.id, query.gameId) as LinkRow | undefined : undefined;
      if (link?.needs_confirmation) throw new Error('作品资料编号已改变，请解绑并重新确认关联。');
      const result = await this.executor.call(source.authorized_path, source.file_identity, tool, query, link?.external_ids_json);
      this.ensureOpen();
      const currentSource = this.source(source.id);
      if (currentSource.file_identity !== source.file_identity) throw new Error('授权数据库已被替换，请重新选择并确认关联。');
      this.verifyIdentity(currentSource);
      return result;
    });
  }
  private ensureOpen(): void { if (this.closed) throw new Error('游玩记录连接已关闭。'); }
  private source(id: string): SourceRow {
    this.ensureOpen();
    const source = this.provisional.get(id) ?? this.db.prepare('SELECT * FROM external_play_sources WHERE id=?').get(id) as SourceRow | undefined;
    if (!source) throw new Error('数据连接不存在，请在设置中选择 ReinaManager 数据库。');
    return source;
  }
  private verifyIdentity(source: SourceRow): void {
    try {
      const current = fileIdentity(source.authorized_path);
      if (current.path === source.authorized_path && current.identity === source.file_identity) return;
    } catch { /* Keep filesystem diagnostics and paths private. */ }
    throw new Error('授权数据库已移动、被替换或不可读取，请重新选择数据库并确认关联。');
  }
  sources(): ReinaSource[] { this.ensureOpen(); return (this.db.prepare('SELECT * FROM external_play_sources ORDER BY connected_at,id').all() as SourceRow[]).map(publicSource); }
  /** Only the native file dialog handler may supply this path; never exposed as IPC input. */
  async connectSelectedFile(selectedPath: string): Promise<ReinaSource> {
    this.ensureOpen();
    let selected: ReturnType<typeof fileIdentity>;
    try { selected = fileIdentity(selectedPath); } catch { throw new Error('无法授权所选文件，请选择本机普通数据库文件。'); }
    if (this.db.name !== ':memory:' && selected.path.toLocaleLowerCase() === realpathSync(this.db.name).toLocaleLowerCase()) throw new Error('不能把 NatsumeNote 自己的数据库作为游玩记录来源。');
    const existing = this.db.prepare('SELECT * FROM external_play_sources WHERE authorized_path=?').get(selected.path) as SourceRow | undefined;
    if (existing) {
      if (existing.file_identity === selected.identity) {
        await this.query('reina_get_connection', { sourceId: existing.id });
        return publicSource(existing);
      }
      // Native selection authorizes the new file, never its old game bindings.
      const replacement = { ...existing, file_identity: selected.identity };
      this.provisional.set(existing.id, replacement);
      try {
        await this.query('reina_get_connection', { sourceId: existing.id });
        this.ensureOpen(); this.verifyIdentity(replacement);
        this.db.transaction(() => {
          this.db.prepare('UPDATE external_play_sources SET file_identity=? WHERE id=?').run(selected.identity, existing.id);
          this.db.prepare('UPDATE external_game_links SET needs_confirmation=1 WHERE source_id=?').run(existing.id);
          this.db.prepare('DELETE FROM game_tag_index WHERE source_id=?').run(existing.id);
        })();
        this.executor.invalidate(existing.id);
        for (const key of this.previews.keys()) if (key.startsWith(`${existing.id}:`)) this.previews.delete(key);
        return publicSource(replacement);
      } finally { this.provisional.delete(existing.id); }
    }
    const row: SourceRow = { id: randomUUID(), label: `ReinaManager 连接 ${this.sources().length + 1}`, authorized_path: selected.path, file_identity: selected.identity, connected_at: new Date().toISOString() };
    this.provisional.set(row.id, row);
    try {
      await this.query('reina_get_connection', { sourceId: row.id });
      this.ensureOpen(); this.verifyIdentity(row);
      this.db.prepare('INSERT INTO external_play_sources(id,label,authorized_path,file_identity,connected_at) VALUES (@id,@label,@authorized_path,@file_identity,@connected_at)').run(row);
      return publicSource(row);
    } finally { this.provisional.delete(row.id); }
  }
  disconnect(sourceId: string): void {
    this.ensureOpen();
    this.db.prepare('DELETE FROM external_play_sources WHERE id=?').run(sourceId);
    this.executor.invalidate(sourceId);
    if (this.sources().length === 0) this.executor.suspend?.();
    for (const key of this.previews.keys()) if (key.startsWith(`${sourceId}:`)) this.previews.delete(key);
  }
  links(localGameId: string): ReinaLink[] { this.ensureOpen(); return (this.db.prepare('SELECT * FROM external_game_links WHERE local_game_id=? ORDER BY source_id').all(localGameId) as LinkRow[]).map(publicLink); }
  private async findGame(sourceId: string, externalGameId: number): Promise<ReinaGame> {
    const mcp = await this.mcp;
    let cursor: string | undefined; let snapshotId: string | undefined;
    do {
      const result = await mcp.call<ReinaGame[]>('reina_list_games', { sourceId, limit: 100, ...(cursor ? { cursor, snapshotId } : {}) });
      const game = result.data.find(item => item.id === externalGameId);
      if (game) return game;
      cursor = result.nextCursor ?? undefined; snapshotId = result.snapshotId ?? undefined;
    } while (cursor);
    throw new Error('来源作品已不存在，请重新搜索并选择。');
  }
  async bind(link: ReinaLink): Promise<void> {
    this.ensureOpen(); const sourceBefore = this.source(link.sourceId);
    if (!this.db.prepare('SELECT 1 FROM games WHERE id=?').get(link.localGameId)) throw new Error('本地作品不存在。');
    const preview = this.previews.get(`${link.sourceId}:${link.externalGameId}`);
    if (!preview || Date.now() - preview.created >= 300000) throw new Error('来源作品预览已失效，请重新搜索后确认关联。');
    const game = await this.findGame(link.sourceId, link.externalGameId);
    if (preview.identity !== this.gameIdentity(game)) throw new Error('作品资料编号已改变，请重新搜索并确认关联。');
    if (this.source(link.sourceId).file_identity !== sourceBefore.file_identity) throw new Error('授权数据库已被替换，请重新搜索并确认关联。');
    const occupied = this.db.prepare('SELECT local_game_id FROM external_game_links WHERE source_id=? AND external_game_id=?').get(link.sourceId, link.externalGameId) as { local_game_id: string } | undefined;
    if (occupied && occupied.local_game_id !== link.localGameId) throw new Error('这个来源作品已关联到其他本地作品，请先解除原关联。');
    const ids = JSON.stringify([...game.externalIds].sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id)));
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO external_game_links(local_game_id,source_id,external_game_id,external_name,external_ids_json) VALUES (?,?,?,?,?) ON CONFLICT(local_game_id,source_id) DO UPDATE SET external_game_id=excluded.external_game_id,external_name=excluded.external_name,external_ids_json=excluded.external_ids_json,needs_confirmation=0').run(link.localGameId, link.sourceId, game.id, game.name, ids);
      replaceExternalTags(this.db, link.localGameId, link.sourceId, game.tags);
    })();
    this.executor.invalidate(link.sourceId);
  }
  unbind(localGameId: string, sourceId: string): void {
    this.ensureOpen();
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM external_game_links WHERE local_game_id=? AND source_id=?').run(localGameId, sourceId);
      this.db.prepare('DELETE FROM game_tag_index WHERE local_game_id=? AND origin_key=?').run(localGameId, `reina:${sourceId}`);
    })();
    this.executor.invalidate(sourceId);
  }
  async query<T = unknown>(rawTool: unknown, input: unknown): Promise<ReinaEnvelope<T>> {
    this.ensureOpen(); const { tool, query } = validateReinaQuery(rawTool, input);
    const mcp = await this.mcp;
    const result = await mcp.call<T>(tool, query);
    this.ensureOpen();
    if (tool === 'reina_list_games') {
      for (const [key, preview] of this.previews) if (Date.now() - preview.created >= 300000) this.previews.delete(key);
      for (const game of result.data as ReinaGame[]) {
        const key = `${query.sourceId}:${game.id}`;
        this.previews.delete(key); this.previews.set(key, { identity: this.gameIdentity(game), created: Date.now() });
      }
      while (this.previews.size > 1000) this.previews.delete(this.previews.keys().next().value!);
    }
    // Refresh minimal tags after a fresh bound-game stats read. No session mirror is persisted.
    if (tool === 'reina_get_stats' && !query.snapshotId && query.gameId) {
      const link = this.db.prepare('SELECT * FROM external_game_links WHERE source_id=? AND external_game_id=?').get(query.sourceId, query.gameId) as LinkRow | undefined;
      if (link) {
        try {
        const tags: ReinaTag[] = []; let cursor: string | undefined; let snapshotId: string | undefined;
        do {
          const page = await mcp.call<ReinaTag[]>('reina_get_tags', { sourceId: query.sourceId, gameId: query.gameId, limit: 100, ...(cursor ? { cursor, snapshotId } : {}) });
          tags.push(...page.data); cursor = page.nextCursor ?? undefined; snapshotId = page.snapshotId ?? undefined;
        } while (cursor);
        const current = this.db.prepare('SELECT external_game_id FROM external_game_links WHERE local_game_id=? AND source_id=?').get(link.local_game_id, link.source_id) as { external_game_id: number } | undefined;
        if (current?.external_game_id === link.external_game_id) replaceExternalTags(this.db, link.local_game_id, link.source_id, tags);
        } catch {
          this.ensureOpen();
          return { ...result, warnings: [...result.warnings, '游玩统计已读取，但标签刷新失败；保留上次标签，可稍后重试。'] };
        }
      }
    }
    return result;
  }
  tags(localGameId?: string): ReinaTag[] { this.ensureOpen(); return listIndexedTags(this.db, localGameId); }
  private gameIdentity(game: ReinaGame): string { return JSON.stringify([game.name, [...game.externalIds].sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id))]); }
  filterGames(tags: string[]) { this.ensureOpen(); return filterIndexedGames(this.db, tags); }
  async close(): Promise<void> { this.closed = true; this.executor.close(); await (await this.mcp).close(); }
}
