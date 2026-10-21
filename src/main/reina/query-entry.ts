import { ReinaAdapter } from './adapter';
import { ReinaQueryEngine } from './engine';
import { fileIdentity } from './file-identity';
import { reinaFailure } from './errors';
import type { ReinaQuery, ReinaTool } from '../../shared/reina';
const engine = new ReinaQueryEngine(path => new ReinaAdapter(path));
const port = process.parentPort;
if (!port) throw new Error('Reina query process requires Electron utilityProcess.');
port.on('message', ({ data }: { data: { id: number; path: string; identity: string; tool: ReinaTool; query: ReinaQuery; expectedExternalIds?: string; invalidate?: string } }) => {
  if (data.invalidate) { engine.invalidate(data.invalidate); return; }
  try {
    const current = fileIdentity(data.path);
    if (current.path !== data.path || current.identity !== data.identity) throw new Error('授权数据库已被替换，请断开并重新选择。');
    const result = engine.call(data.path, data.tool, data.query, data.expectedExternalIds);
    port.postMessage({ id: data.id, result });
  } catch (error) {
    // Never relay SQLite diagnostics, arbitrary paths, source JSON or stack traces.
    port.postMessage({ id: data.id, error: reinaFailure(error) });
  }
});
