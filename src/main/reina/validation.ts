import { z } from 'zod';
import type { ReinaQuery, ReinaTool } from '../../shared/reina';
const iso = z.string().datetime({ offset: true }).refine(value => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day] = parts.map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}, '日期不存在');
const common = { sourceId: z.string().min(1).max(100), limit: z.number().int().min(1).max(100).optional(), cursor: z.string().min(1).max(100).optional(), snapshotId: z.string().min(1).max(100).optional() };
const range = { gameId: z.number().int().positive().max(2147483647), from: iso.optional(), to: iso.optional() };
const schemas = {
  reina_get_connection: z.object({ sourceId: common.sourceId }).strict(),
  reina_list_games: z.object({ ...common, query: z.string().max(200).optional(), externalId: z.string().min(1).max(100).optional(), provider: z.enum(['vndb', 'bangumi']).optional() }).strict(),
  reina_list_sessions: z.object({ ...common, ...range }).strict(),
  reina_get_stats: z.object({ sourceId: common.sourceId, snapshotId: common.snapshotId, ...range }).strict(),
  reina_get_tags: z.object({ ...common, gameId: range.gameId }).strict(),
};
export function validateReinaQuery(tool: unknown, input: unknown): { tool: ReinaTool; query: ReinaQuery } {
  if (typeof tool !== 'string' || !Object.hasOwn(schemas, tool)) throw new Error('不支持的游玩记录工具。');
  const parsed = schemas[tool as ReinaTool].safeParse(input);
  if (!parsed.success) throw new Error('游玩记录查询参数无效，请检查时间范围与分页条件。');
  const query = parsed.data as ReinaQuery;
  if (Boolean(query.from) !== Boolean(query.to) || (query.from && query.to && Date.parse(query.from) >= Date.parse(query.to))) throw new Error('请选择完整且递增的时间范围。');
  if (Boolean(query.externalId) !== Boolean(query.provider)) throw new Error('资料来源和编号必须一同提供。');
  return { tool: tool as ReinaTool, query };
}
export const reinaToolNames = Object.keys(schemas) as ReinaTool[];
/** Explicit wire schemas keep paths, SQL and command fields outside the MCP boundary. */
export function reinaInputSchema(tool: ReinaTool) {
  const props: Record<string, unknown> = { sourceId: { type: 'string', minLength: 1, maxLength: 100 } };
  const required = ['sourceId'];
  if (tool !== 'reina_get_connection') props.snapshotId = { type: 'string', maxLength: 100 };
  if (tool === 'reina_list_games' || tool === 'reina_list_sessions' || tool === 'reina_get_tags') Object.assign(props, { limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 }, cursor: { type: 'string', maxLength: 100 } });
  if (tool === 'reina_list_sessions' || tool === 'reina_get_stats' || tool === 'reina_get_tags') { props.gameId = { type: 'integer', minimum: 1, maximum: 2147483647 }; required.push('gameId'); }
  if (tool === 'reina_list_sessions' || tool === 'reina_get_stats') Object.assign(props, { from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' } });
  if (tool === 'reina_list_games') Object.assign(props, { query: { type: 'string', maxLength: 200 }, externalId: { type: 'string', maxLength: 100 }, provider: { type: 'string', enum: ['vndb', 'bangumi'] } });
  return { type: 'object' as const, properties: props, required, additionalProperties: false };
}
