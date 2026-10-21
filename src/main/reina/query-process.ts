import { utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import type { ReinaEnvelope, ReinaQuery, ReinaTool } from '../../shared/reina';
import type { ReinaFailure } from './errors';
interface Pending { resolve: (data: ReinaEnvelope) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
export class ReinaQueryProcess {
  private child?: UtilityProcess;
  private pending = new Map<number, Pending>();
  private sequence = 0;
  private closed = false;
  constructor(private readonly timeoutMs = 3000, private readonly entry = path.join(__dirname, 'reina-query.js')) {}
  private start(): UtilityProcess {
    if (this.closed) throw new Error('游玩记录连接已关闭。');
    if (this.child) return this.child;
    const child = utilityProcess.fork(this.entry, [], { serviceName: 'NatsumeNote Reina 只读查询', stdio: 'ignore' });
    this.child = child;
    child.on('message', (message: { id: number; result?: ReinaEnvelope; error?: ReinaFailure }) => {
      if (this.child !== child) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.result) pending.resolve(message.result);
      else pending.reject(Object.assign(new Error(message.error?.message ?? '无法读取数据库，请重新选择兼容的 ReinaManager 数据库。'), { code: message.error?.code, retryable: message.error?.retryable }));
    });
    child.once('exit', () => { if (this.child === child) this.reset('游玩记录查询进程已退出，请重试。'); });
    return child;
  }
  call(path: string, identity: string, tool: ReinaTool, query: ReinaQuery, expectedExternalIds?: string): Promise<ReinaEnvelope> {
    if (this.pending.size >= 8) return Promise.reject(new Error('游玩记录查询较多，请稍后再试。'));
    const child = this.start(); const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.reset('读取游玩记录超时，请稍后刷新。'); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { child.postMessage({ id, path, identity, tool, query, expectedExternalIds }); }
      catch { this.reset('游玩记录查询进程无法连接，请重试。'); }
    });
  }
  invalidate(sourceId: string): void { this.child?.postMessage({ invalidate: sourceId }); }
  private reset(message: string): void {
    const child = this.child; this.child = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
    this.pending.clear(); child?.kill();
  }
  suspend(): void { this.reset('游玩记录连接已断开，请重新连接。'); }
  close(): void { this.closed = true; this.reset('游玩记录连接已关闭。'); }
}
