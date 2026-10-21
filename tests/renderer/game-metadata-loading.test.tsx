/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGameMetadata } from '../../src/renderer/src/hooks/useGameMetadata';
import type { GameMetadataSummary } from '../../src/shared/types';

const summary = (gameId = 'game'): GameMetadataSummary => ({ gameId, coverSource: null, sources: [] });
afterEach(() => { cleanup(); delete (window as unknown as { galMusic?: unknown }).galMusic; });
describe('metadata loading after import', () => {
  function install(getGameMetadata: ReturnType<typeof vi.fn>) {
    Object.defineProperty(window, 'galMusic', { configurable: true, value: { getGameMetadata } });
  }
  it('reloads imported IDs without clearing content and exposes refresh failures', async () => {
    const cached = summary();
    const get = vi.fn().mockResolvedValueOnce(cached).mockRejectedValueOnce(new Error('网络暂时不可用'));
    install(get);
    const { result } = renderHook(() => useGameMetadata('game'));
    await waitFor(() => expect(result.current.metadata).toEqual(cached));
    act(() => { window.dispatchEvent(new Event('reina-tags-changed')); });
    await waitFor(() => expect(result.current.error).toBe('网络暂时不可用'));
    expect(result.current.metadata).toEqual(cached);
    expect(result.current.loading).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('ignores responses for an old game and removes the import listener on unmount', async () => {
    let resolveOld!: (value: GameMetadataSummary) => void;
    const get = vi.fn().mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue(summary('new'));
    install(get);
    const view = renderHook(({ id }) => useGameMetadata(id), { initialProps: { id: 'old' } });
    view.rerender({ id: 'new' });
    await waitFor(() => expect(view.result.current.metadata?.gameId).toBe('new'));
    await act(async () => { resolveOld(summary('old')); });
    expect(view.result.current.metadata?.gameId).toBe('new');
    view.unmount();
    act(() => { window.dispatchEvent(new Event('reina-tags-changed')); });
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('does not replace a manually saved result with an earlier request', async () => {
    let resolveOld!: (value: GameMetadataSummary) => void;
    install(vi.fn().mockReturnValue(new Promise(resolve => { resolveOld = resolve; })));
    const { result } = renderHook(() => useGameMetadata('game'));
    const saved = { ...summary(), coverSource: 'vndb' as const };
    act(() => result.current.setMetadata(saved));
    await act(async () => { resolveOld(summary()); });
    expect(result.current.metadata).toEqual(saved);
    expect(result.current.loading).toBe(false);
  });
});
