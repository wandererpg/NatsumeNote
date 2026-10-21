import { z } from 'zod';
import { REINA_CHANNELS, type ReinaLink } from '../../shared/reina';
import { AppError } from '../../shared/errors';
import type { ReinaService } from '../reina/service';
import type { UpdateInstallGuard } from '../services/update-install-guard';
import type { IpcMainLike } from './library-handlers';
import type { DialogLike } from './dialog-handlers';
import { assertArgumentCount, invalidArgument } from './validation';
const id = z.string().min(1).max(100);
const tagsSchema = z.array(z.string().min(1).max(208).regex(/^(vndb|bangumi|custom):.+$/s)).max(100);
const linkSchema = z.object({ localGameId: id, sourceId: id, externalGameId: z.number().int().positive().max(2147483647), externalName: z.string().max(500) }).strict();
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw invalidArgument('游玩记录参数无效，请重新选择。');
  return result.data;
}
export function registerReinaHandlers({ ipc, dialog, service, guard }: { ipc: IpcMainLike; dialog: DialogLike; service: ReinaService; guard: UpdateInstallGuard }): void {
  function register(channel: string, count: number, handler: (event: unknown, args: unknown[]) => unknown) {
    ipc.handle(channel, (event, ...args) => {
      assertArgumentCount(args, count, channel);
      return guard.run(async () => {
        try { return await handler(event, args); }
        catch (error) {
          if (error instanceof AppError) throw error;
          const raw = error instanceof Error ? error.message.replace(/^MCP error -?\d+: /, '') : '';
          if (/^(游玩记录查询参数|请选择完整|资料来源和编号|不支持的游玩记录)/.test(raw) || (error && typeof error === 'object' && 'code' in error && error.code === 'INVALID_INPUT')) throw invalidArgument(raw);
          const safe = /^(数据连接|授权数据库|数据库身份|无法授权|不能把 NatsumeNote|本地作品|来源作品|这个来源作品|游玩记录|作品资料编号|分页已失效|快照已失效|记录超过|请选择完整|资料来源和编号|无法读取数据库|读取游玩记录|不支持的游玩记录)/.test(raw);
          const message = safe ? raw : '游玩记录操作失败，请检查数据连接后重试。';
          throw new AppError('DB_ERROR', message, message);
        }
      });
    });
  }
  register(REINA_CHANNELS.sources, 0, () => service.sources());
  register(REINA_CHANNELS.connect, 0, async event => {
    const owner = (event as { sender?: { getOwnerBrowserWindow?: () => unknown } })?.sender?.getOwnerBrowserWindow?.();
    const selected = await dialog.showOpenDialog(owner, { properties: ['openFile'], filters: [{ name: 'ReinaManager 数据库', extensions: ['db', 'sqlite', 'sqlite3'] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return service.connectSelectedFile(selected.filePaths[0]);
  });
  register(REINA_CHANNELS.disconnect, 1, (_event, [sourceId]) => service.disconnect(parse(id, sourceId)));
  register(REINA_CHANNELS.query, 2, (_event, [tool, query]) => service.query(tool, query));
  register(REINA_CHANNELS.links, 1, (_event, [gameId]) => service.links(parse(id, gameId)));
  register(REINA_CHANNELS.bind, 1, (_event, [link]) => service.bind(parse(linkSchema, link) as ReinaLink));
  register(REINA_CHANNELS.unbind, 2, (_event, [gameId, sourceId]) => service.unbind(parse(id, gameId), parse(id, sourceId)));
  register(REINA_CHANNELS.filterGames, 1, (_event, [tags]) => service.filterGames(parse(tagsSchema, tags)));
  register(REINA_CHANNELS.tags, 1, (_event, [gameId]) => service.tags(gameId === undefined ? undefined : parse(id, gameId)));
}
