import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ReinaEnvelope, ReinaQuery, ReinaTool } from '../../shared/reina';
import { reinaInputSchema, reinaToolNames, validateReinaQuery } from './validation';
import { reinaFailure } from './errors';
export async function createReinaMcp(execute: (tool: ReinaTool, query: ReinaQuery) => Promise<ReinaEnvelope>) {
  const server = new Server({ name: 'natsume-reina-readonly', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: reinaToolNames.map(name => ({ name, description: '只读读取用户授权的 ReinaManager 已保存记录。时长单位为四舍五入的分钟，运行中会话不可见。', inputSchema: reinaInputSchema(name), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } })) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const { tool, query } = validateReinaQuery(request.params.name, request.params.arguments);
    try {
      const result = await execute(tool, query);
      return { content: [{ type: 'text' as const, text: `ReinaManager 只读记录，快照 ${result.snapshotId}；${result.warnings.join(' ')}` }], structuredContent: result as unknown as Record<string, unknown> };
    } catch (error) {
      const failure = reinaFailure(error);
      return { isError: true, content: [{ type: 'text' as const, text: failure.message }], structuredContent: failure };
    }
  });
  const client = new Client({ name: 'natsume-note', version: '1.0.0' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport); // Real MCP initialize / initialized handshake.
  const listed = await client.listTools();
  if (listed.tools.length !== 5) throw new Error('游玩记录工具初始化失败。');
  return {
    client,
    async call<T>(tool: ReinaTool, query: ReinaQuery): Promise<ReinaEnvelope<T>> {
      validateReinaQuery(tool, query);
      const result = await client.callTool({ name: tool, arguments: { ...query } });
      if (result.isError) {
        const failure = result.structuredContent as { message?: unknown; code?: unknown; retryable?: unknown } | undefined;
        throw Object.assign(new Error(typeof failure?.message === 'string' ? failure.message : '游玩记录工具读取失败，请重新连接。'), { code: failure?.code, retryable: failure?.retryable });
      }
      if (!result.structuredContent) throw new Error('游玩记录工具读取失败，请重新连接。');
      return result.structuredContent as unknown as ReinaEnvelope<T>;
    },
    async close() { await client.close(); await server.close(); },
  };
}
