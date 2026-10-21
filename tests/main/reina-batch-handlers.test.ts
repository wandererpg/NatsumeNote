import { expect, it, vi } from 'vitest';
import { registerReinaBatchHandlers } from '../../src/main/ipc/reina-batch-handlers';
import { UpdateInstallGuard } from '../../src/main/services/update-install-guard';
import { REINA_CHANNELS } from '../../src/shared/reina';
import type { ReinaBatchImport } from '../../src/main/reina/batch-import';

function fixture() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const importer = { preview: vi.fn().mockResolvedValue({ token: 'token' }), apply: vi.fn().mockResolvedValue({ created: 1 }) };
  const guard = new UpdateInstallGuard();
  registerReinaBatchHandlers({ handle: (channel, listener) => { handlers.set(channel, listener); } }, importer as unknown as ReinaBatchImport, guard);
  const sender = {};
  const call = async (channel: string, args: unknown[], window = sender) => handlers.get(channel)!({ sender: window }, ...args);
  return { call, importer, guard };
}
it('validates batch decisions, isolates preview tokens by sender, and consumes successful previews', async () => {
  const { call, importer } = fixture();
  const decision = { externalGameId: 1, action: 'create' };
  await expect(call(REINA_CHANNELS.batchPreview, ['s', 'C:/injected'])).rejects.toThrow();
  await call(REINA_CHANNELS.batchPreview, ['s']);
  await expect(call(REINA_CHANNELS.batchApply, ['token', [decision]], {})).rejects.toThrow();
  await expect(call(REINA_CHANNELS.batchApply, ['token', [{ ...decision, path: 'C:/injected' }]])).rejects.toThrow();
  await expect(call(REINA_CHANNELS.batchApply, ['token', [{ ...decision, externalGameId: -1 }]])).rejects.toThrow();
  expect(importer.apply).not.toHaveBeenCalled();
  await call(REINA_CHANNELS.batchApply, ['token', [decision]]);
  expect(importer.apply).toHaveBeenCalledWith('token', [decision]);
  await expect(call(REINA_CHANNELS.batchApply, ['token', [decision]])).rejects.toThrow();
});
it('prevents overlapping library operations and releases the lock after failures without exposing paths', async () => {
  const { call, importer, guard } = fixture();
  const finish = guard.begin();
  await expect(call(REINA_CHANNELS.batchPreview, ['s'])).rejects.toThrow(); finish();
  importer.preview.mockRejectedValueOnce(new Error('EACCES C:/private/reina.db'));
  await expect(call(REINA_CHANNELS.batchPreview, ['s'])).rejects.toThrow('导入失败');
  await expect(call(REINA_CHANNELS.batchPreview, ['s'])).resolves.toEqual({ token: 'token' });
});
