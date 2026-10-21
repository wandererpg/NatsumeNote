import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmdirSync } from 'node:fs';
import path from 'node:path';
import { assertWithin, sanitizeDirectoryName } from '../../shared/paths';
import type { ReinaBatchDecision, ReinaBatchPreview, ReinaBatchResult, ReinaBatchRow, ReinaGame } from '../../shared/reina';
import { createGame } from '../database/queries/games';
import { replaceExternalTags } from './tag-index';
import type { ReinaService } from './service';

const title = (name: string) => name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
const externalId = (provider: string, value: string) => `${provider}:${value.trim().replace(provider === 'vndb' ? /^v/i : /^$/, '').toLowerCase()}`;
const signature = (games: ReinaGame[]) => JSON.stringify([...games].sort((a, b) => a.id - b.id));
const stale = () => new Error('导入预览已变化或失效，请重新预览后确认。');
interface Link { local_game_id: string; external_game_id: number; external_name: string; external_ids_json: string; needs_confirmation: number }
interface PreviewState { preview: ReinaBatchPreview; games: ReinaGame[]; sourceId: string; changes: number; createdAt: number }

/** Only writes the local library; source access remains inside the readonly Reina service. */
export class ReinaBatchImport {
  private previews = new Map<string, PreviewState>();
  constructor(private db: Database.Database, private service: ReinaService, private getLibraryPath: () => string) {}
  private changes(): number { return (this.db.prepare('SELECT total_changes() n').get() as { n: number }).n; }
  private async readGames(sourceId: string): Promise<{ games: ReinaGame[]; warnings: string[] }> {
    const games: ReinaGame[] = []; const warnings = new Set<string>(); const cursors = new Set<string>();
    let cursor: string | undefined; let snapshotId: string | undefined;
    do {
      const page = await this.service.query<ReinaGame[]>('reina_list_games', { sourceId, limit: 100, ...(cursor ? { cursor, snapshotId } : {}) });
      games.push(...page.data); page.warnings.forEach(warning => warnings.add(warning));
      if (games.length > 5000) throw new Error('导入作品超过 5000 部，请缩小来源资料库。');
      cursor = page.nextCursor ?? undefined; snapshotId = page.snapshotId ?? undefined;
      if (cursor && cursors.has(cursor)) throw stale();
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (new Set(games.map(game => game.id)).size !== games.length) throw stale();
    return { games, warnings: [...warnings] };
  }
  async preview(sourceId: string): Promise<ReinaBatchPreview> {
    const changes = this.changes(); const libraryPath = path.resolve(this.getLibraryPath());
    const { games, warnings } = await this.readGames(sourceId);
    if (changes !== this.changes() || libraryPath !== path.resolve(this.getLibraryPath())) throw stale();
    const links = this.db.prepare('SELECT local_game_id,external_game_id,external_name,external_ids_json,needs_confirmation FROM external_game_links WHERE source_id=?').all(sourceId) as Link[];
    const localGames = (this.db.prepare('SELECT id,name FROM games ORDER BY name,id').all() as { id: string; name: string }[])
      .map(game => ({ ...game, boundExternalGameId: links.find(link => link.local_game_id === game.id)?.external_game_id }));
    const metadata = this.db.prepare("SELECT game_id,source,external_id FROM game_sources WHERE status='matched' AND external_id IS NOT NULL").all() as { game_id: string; source: string; external_id: string }[];
    const usedNames = new Set(localGames.map(game => title(game.name)));
    const usedFolders = new Set(localGames.map(game => sanitizeDirectoryName(game.name).toLowerCase()));
    if (existsSync(libraryPath)) readdirSync(libraryPath).forEach(name => usedFolders.add(name.toLowerCase()));
    const allocate = (original: string) => {
      // Keep the record name equal to its directory name so a later library scan
      // finds this empty record instead of creating a second game.
      const base = sanitizeDirectoryName(original.trim().slice(0, 100) || '未命名作品'); let name = base; let suffix = 2;
      while (usedNames.has(title(name)) || usedFolders.has(sanitizeDirectoryName(name).toLowerCase())) name = `${base} (${suffix++})`;
      usedNames.add(title(name)); usedFolders.add(sanitizeDirectoryName(name).toLowerCase()); return name;
    };
    const rows: ReinaBatchRow[] = games.map(game => {
      const linked = links.find(link => link.external_game_id === game.id);
      if (linked) {
        const ids = JSON.stringify([...game.externalIds].sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id)));
        const needsConfirmation = Boolean(linked.needs_confirmation) || linked.external_ids_json !== ids || linked.external_name !== game.name;
        return { externalGameId: game.id, name: game.name, action: needsConfirmation ? 'review' : 'link', localGameId: linked.local_game_id, alreadyLinked: true,
          reason: needsConfirmation ? '来源或作品信息已改变，请手动核对并重新确认原关联；目标不符时需先解除旧关联' : '已有来源关联' };
      }
      const ids = new Set(game.externalIds.map(id => externalId(id.provider, id.id)));
      const byId = [...new Set(metadata.filter(row => ids.has(externalId(row.source, row.external_id))).map(row => row.game_id))];
      const candidates = byId.length ? byId : localGames.filter(local => title(local.name) === title(game.name)).map(local => local.id);
      const candidate = candidates.length === 1 ? localGames.find(local => local.id === candidates[0]) : undefined;
      const common = { externalGameId: game.id, name: game.name, alreadyLinked: false, newName: allocate(game.name) };
      if (candidate && metadata.some(row => row.game_id === candidate.id && game.externalIds.some(id => id.provider === row.source && externalId(id.provider, id.id) !== externalId(row.source, row.external_id)))) {
        return { ...common, action: 'review', reason: '部分信息一致但资料编号存在冲突，请手动核对' };
      }
      if (candidate && candidate.boundExternalGameId === undefined) return { ...common, action: 'link', localGameId: candidate.id, reason: byId.length ? '资料编号一致' : '完整标题一致' };
      if (candidates.length) return { ...common, action: 'review', reason: candidate ? '对应作品已有其他来源关联，请手动选择' : '存在多个匹配，请手动选择' };
      return { ...common, action: 'create', reason: '未找到对应作品，将新建作品和文件夹' };
    });
    for (const row of rows) {
      if (row.action === 'link' && !row.alreadyLinked && rows.some(other => other !== row && other.localGameId === row.localGameId)) {
        row.action = 'review'; row.reason = '多个来源作品匹配同一作品，请手动选择';
      }
    }
    const preview = { token: randomUUID(), libraryPath, rows, localGames, warnings };
    for (const [token, state] of this.previews) if (Date.now() - state.createdAt >= 300000) this.previews.delete(token);
    if (this.previews.size >= 20) this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(preview.token, { preview: structuredClone(preview), games: structuredClone(games), sourceId, changes, createdAt: Date.now() });
    return preview;
  }
  async apply(token: string, decisions: ReinaBatchDecision[]): Promise<ReinaBatchResult> {
    const state = this.previews.get(token);
    if (!state || Date.now() - state.createdAt >= 300000 || state.changes !== this.changes() || state.preview.libraryPath !== path.resolve(this.getLibraryPath())) throw stale();
    if (decisions.length !== state.games.length || new Set(decisions.map(row => row.externalGameId)).size !== decisions.length) throw new Error('导入选项不完整，请重新预览。');
    const targets = new Set<string>();
    for (const decision of decisions) {
      const row = state.preview.rows.find(item => item.externalGameId === decision.externalGameId);
      if (!row || !['link', 'create', 'skip', 'review'].includes(decision.action)) throw new Error('导入选项无效。');
      if (decision.action === 'review') throw new Error('导入前请手动处理所有待确认的作品。');
      if (decision.action === 'skip') continue;
      if (row.alreadyLinked && (decision.action !== 'link' || decision.localGameId !== row.localGameId)) throw new Error('导入不能覆盖已有来源关联，请先解除原关联。');
      if (decision.action === 'link') {
        const local = state.preview.localGames.find(game => game.id === decision.localGameId);
        if (!local || (local.boundExternalGameId !== undefined && local.boundExternalGameId !== row.externalGameId) || targets.has(local.id)) throw new Error('导入目标重复或已关联其他来源作品，请手动调整。');
        targets.add(local.id);
      } else if (!row.newName) throw new Error('导入不能覆盖已有来源关联。');
    }
    const current = await this.readGames(state.sourceId);
    if (state.changes !== this.changes() || state.preview.libraryPath !== path.resolve(this.getLibraryPath()) || signature(current.games) !== signature(state.games)) throw stale();
    const createdFolders: string[] = [];
    const result = { created: 0, linked: 0, skipped: 0 };
    try {
      const needsFolders = decisions.some(row => row.action === 'create');
      if (needsFolders) mkdirSync(state.preview.libraryPath, { recursive: true });
      const root = needsFolders ? realpathSync(state.preview.libraryPath) : state.preview.libraryPath;
      this.db.transaction(() => {
        for (const decision of decisions) {
          if (decision.action === 'skip') { result.skipped++; continue; }
          const row = state.preview.rows.find(item => item.externalGameId === decision.externalGameId)!;
          const game = current.games.find(item => item.id === decision.externalGameId)!;
          let localId = decision.localGameId!;
          if (decision.action === 'create') {
            const folder = assertWithin(path.join(root, sanitizeDirectoryName(row.newName!)), root);
            if (existsSync(folder)) throw stale();
            mkdirSync(folder); createdFolders.push(folder);
            if (lstatSync(folder).isSymbolicLink() || realpathSync(folder) !== folder) throw new Error('导入目录边界检查失败。');
            localId = randomUUID(); createGame(this.db, { id: localId, name: row.newName! }); result.created++;
          } else result.linked++;
          const ids = JSON.stringify([...game.externalIds].sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id)));
          this.db.prepare('INSERT INTO external_game_links(local_game_id,source_id,external_game_id,external_name,external_ids_json) VALUES (?,?,?,?,?) ON CONFLICT(local_game_id,source_id) DO UPDATE SET external_name=excluded.external_name,external_ids_json=excluded.external_ids_json,needs_confirmation=0').run(localId, state.sourceId, game.id, game.name, ids);
          replaceExternalTags(this.db, localId, state.sourceId, game.tags);
        }
      })();
      this.previews.delete(token);
      return result;
    } catch (error) {
      for (const folder of createdFolders.reverse()) {
        // Never recurse: concurrently added user files must survive rollback.
        try { if (!lstatSync(folder).isSymbolicLink()) rmdirSync(folder); } catch { /* Nonempty directories are preserved. */ }
      }
      throw error;
    }
  }
}
