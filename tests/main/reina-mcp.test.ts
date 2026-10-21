import { expect, it } from 'vitest';
import { createReinaMcp } from '../../src/main/reina/mcp';

it('reports a deleted source game as invalid input without suggesting a retry', async () => {
  const mcp = await createReinaMcp(async () => { throw new Error('来源作品已不存在，请重新搜索并选择。'); });
  try {
    const result = await mcp.client.callTool({ name: 'reina_get_connection', arguments: { sourceId: 'authorized' } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'INVALID_INPUT', retryable: false });
    await expect(mcp.call('reina_get_connection', { sourceId: 'authorized' })).rejects.toMatchObject({ code: 'INVALID_INPUT', retryable: false });
  } finally { await mcp.close(); }
});

it('preserves safe business classification through the MCP client', async () => {
  const mcp = await createReinaMcp(async () => { throw Object.assign(new Error('private path and SQL'), {code:'SOURCE_BUSY'}); });
  try {
    await expect(mcp.call('reina_get_connection',{sourceId:'authorized'})).rejects.toMatchObject({code:'SOURCE_BUSY',retryable:true});
    const result = await mcp.client.callTool({name:'reina_get_connection',arguments:{sourceId:'authorized'}});
    expect(result.structuredContent).toMatchObject({code:'SOURCE_BUSY',retryable:true});
    expect(JSON.stringify(result)).not.toContain('private path');
  } finally { await mcp.close(); }
});

it('returns sanitized MCP business errors without leaking database paths', async () => {
  let error = new Error('快照已失效或与当前作品不符，请刷新。');
  const mcp = await createReinaMcp(async () => { throw error; });
  try {
    const result = await mcp.client.callTool({ name: 'reina_get_connection', arguments: { sourceId: 'authorized' } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: 'SNAPSHOT_EXPIRED', retryable: true });
    await expect(mcp.call('reina_get_connection', { sourceId: 'authorized' })).rejects.toThrow('快照已失效');
    error = new Error('SQLITE_ERROR at D:\\private\\user.db: secret row');
    const failure = await mcp.client.callTool({ name: 'reina_get_connection', arguments: { sourceId: 'authorized' } });
    expect(failure.isError).toBe(true);
    expect(JSON.stringify(failure)).not.toMatch(/private|secret|SQLITE_ERROR/);
    expect(failure.structuredContent).toMatchObject({ code: 'SOURCE_UNAVAILABLE', retryable: true });
  } finally { await mcp.close(); }
});
it('initializes the official MCP transport, lists five read-only tools and returns structured content', async () => {
  const mcp = await createReinaMcp(async (_tool, query) => ({ contractVersion: 1, sourceApp: 'ReinaManager', sourceId: query.sourceId, snapshotId: 'snapshot', fetchedAt: new Date().toISOString(), warnings: [], data: { readable: true }, nextCursor: null }));
  try {
    const tools = await mcp.client.listTools();
    expect(tools.tools).toHaveLength(5);
    expect(tools.tools.every(tool => tool.annotations?.readOnlyHint)).toBe(true);
    expect((await mcp.call('reina_get_connection', { sourceId: 'authorized' })).data).toEqual({ readable: true });
    await expect(mcp.client.callTool({ name: 'reina_get_connection', arguments: { sourceId: 'x', path: '/private.db' } })).rejects.toThrow();
  } finally { await mcp.close(); }
});
