import { describe, expect, it, vi } from 'vitest';
import { registerReinaHandlers } from '../../src/main/ipc/reina-handlers';
import { UpdateInstallGuard } from '../../src/main/services/update-install-guard';
import { REINA_CHANNELS } from '../../src/shared/reina';
import type { ReinaService } from '../../src/main/reina/service';
function fixture() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const service = { connectSelectedFile: vi.fn().mockResolvedValue({ id: 's' }), query: vi.fn(), tags: vi.fn(), bind: vi.fn() };
  const dialog = { showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['C:/native-selected/reina_manager.db'] }) };
  const guard = new UpdateInstallGuard();
  registerReinaHandlers({ ipc: { handle: (channel, listener) => { handlers.set(channel, listener); } }, dialog, service: service as unknown as ReinaService, guard });
  const call = async (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);
  return { call, service, dialog, guard };
}
describe('Reina IPC boundary', () => {
  it('accepts a database path only from the native dialog, never from renderer arguments', async () => {
    const { call, service, dialog } = fixture();
    await expect(call(REINA_CHANNELS.connect, 'C:/injected.db')).rejects.toThrow();
    expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    await call(REINA_CHANNELS.connect);
    expect(service.connectSelectedFile).toHaveBeenCalledWith('C:/native-selected/reina_manager.db');
  });
  it('rejects oversized filters, extra link fields and operations while updates are locked', async () => {
    const { call, service, guard } = fixture();
    await expect(call(REINA_CHANNELS.filterGames, Array(101).fill('tag'))).rejects.toThrow();
    await expect(call(REINA_CHANNELS.bind, { localGameId: 'g', sourceId: 's', externalGameId: 42, externalName: 'x', path: 'private' })).rejects.toThrow();
    expect(service.bind).not.toHaveBeenCalled();
    guard.lock(); await expect(call(REINA_CHANNELS.connect)).rejects.toThrow(); guard.unlock();
  });
});
