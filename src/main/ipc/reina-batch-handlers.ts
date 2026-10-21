import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { REINA_CHANNELS } from '../../shared/reina';
import type { ReinaBatchImport } from '../reina/batch-import';
import type { UpdateInstallGuard } from '../services/update-install-guard';
import type { IpcMainLike } from './library-handlers';
import { assertArgumentCount, invalidArgument } from './validation';

const id = z.string().min(1).max(100);
const decisions = z.array(z.object({ externalGameId: z.number().int().positive().max(2147483647), action: z.enum(['link', 'create', 'skip', 'review']), localGameId: id.optional() }).strict()).max(5000);

export function registerReinaBatchHandlers(ipc: IpcMainLike, importer: ReinaBatchImport, guard: UpdateInstallGuard): void {
  const tokens = new Map<unknown, string>();
  const sender = (event: unknown) => (event as { sender?: unknown })?.sender;
  const exclusive = async <T>(action: () => Promise<T>): Promise<T> => {
    guard.lock();
    try { return await action(); }
    catch (error) {
      if (error instanceof AppError) throw error;
      const raw = error instanceof Error ? error.message.replace(/^MCP error -?\d+: /, '') : '';
      const message = /^(导入|数据连接|授权数据库|数据库身份|来源作品|作品资料编号|分页已失效|快照已失效|无法读取数据库|读取游玩记录)/.test(raw) ? raw : '导入失败，未保存本次作品关联。请检查音乐库权限和数据连接后重新预览。';
      throw new AppError('DB_ERROR', message, message);
    } finally { guard.unlock(); }
  };
  ipc.handle(REINA_CHANNELS.batchPreview, (event, ...args) => {
    assertArgumentCount(args, 1, REINA_CHANNELS.batchPreview);
    const result = id.safeParse(args[0]); if (!result.success) throw invalidArgument('来源编号无效。');
    return exclusive(async () => {
      tokens.delete(sender(event));
      const preview = await importer.preview(result.data);
      tokens.set(sender(event), preview.token);
      return preview;
    });
  });
  ipc.handle(REINA_CHANNELS.batchApply, (event, ...args) => {
    assertArgumentCount(args, 2, REINA_CHANNELS.batchApply);
    const token = id.safeParse(args[0]); const rows = decisions.safeParse(args[1]);
    if (!token.success || !rows.success) throw invalidArgument('导入选项无效。');
    if (!sender(event) || tokens.get(sender(event)) !== token.data) throw invalidArgument('导入预览已失效，请重新预览。');
    return exclusive(async () => {
      const result = await importer.apply(token.data, rows.data);
      tokens.delete(sender(event)); return result;
    });
  });
}
