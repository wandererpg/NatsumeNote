import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  contextBridge: undefined,
  ipcRenderer: undefined,
}));

import { createGalMusicApi, type IpcRendererLike } from '../../src/preload';
import { IPC_JOURNAL_SELECT_MEDIA, IPC_LIBRARY_BULK_UPDATE_TRACKS, IPC_LIBRARY_GET_GAME_METADATA, IPC_LIBRARY_REFRESH_GAME_METADATA, IPC_LIBRARY_SELECT_GAME_METADATA_CANDIDATE, IPC_LIBRARY_TRANSLATE_GAME_SUMMARY } from '../../src/shared/ipc';
import type { BulkTrackRequest } from '../../src/shared/types';
import { REINA_CHANNELS } from '../../src/shared/reina';

describe('preload bridge', () => {
  it('exposes only fixed Reina commands, with no path argument on authorization', async () => {
    const ipc: IpcRendererLike = { invoke: vi.fn().mockResolvedValue(null), on: vi.fn() };
    const api = createGalMusicApi(ipc);
    await api.reinaConnect!();
    await api.reinaQuery!('reina_get_stats', {sourceId:'s',gameId:42});
    await api.filterGamesByTags!(['剧情','校园']);
    expect(ipc.invoke).toHaveBeenNthCalledWith(1,REINA_CHANNELS.connect);
    expect(ipc.invoke).toHaveBeenNthCalledWith(2,REINA_CHANNELS.query,'reina_get_stats',{sourceId:'s',gameId:42});
    expect(ipc.invoke).toHaveBeenNthCalledWith(3,REINA_CHANNELS.filterGames,['剧情','校园']);
    expect(api).not.toHaveProperty('invoke');
  });
  it('exposes the allow-listed scrapbook media picker', async () => {
    const assets = [{ id: 'asset-1', kind: 'image' }];
    const ipc: IpcRendererLike = { invoke: vi.fn().mockResolvedValue(assets), on: vi.fn() };
    const api = createGalMusicApi(ipc);

    await expect(api.selectJournalMedia?.('g1', 'image')).resolves.toEqual(assets);
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_JOURNAL_SELECT_MEDIA, 'g1', 'image');
  });

  it('exposes bulk track updates as one allow-listed IPC invocation', async () => {
    const request: BulkTrackRequest = {
      sourceGameId: 'g1',
      trackIds: ['t1', 't2'],
      operation: { type: 'playlist-add', playlistId: 'p1' },
    };
    const result = { succeededIds: ['t1', 't2'], failures: [] };
    const ipc: IpcRendererLike = {
      invoke: vi.fn().mockResolvedValue(result),
      on: vi.fn(),
    };
    const api = createGalMusicApi(ipc);

    await expect(api.bulkUpdateTracks(request)).resolves.toEqual(result);
    expect(ipc.invoke).toHaveBeenCalledOnce();
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_LIBRARY_BULK_UPDATE_TRACKS, request);
  });

  it('exposes game metadata read and refresh without leaking ipcRenderer', async () => {
    const summary = { gameId: 'g1', coverSource: null, sources: [] };
    const ipc: IpcRendererLike = {
      invoke: vi.fn().mockResolvedValue(summary),
      on: vi.fn(),
    };
    const api = createGalMusicApi(ipc);

    await expect(api.getGameMetadata?.('g1')).resolves.toEqual(summary);
    await expect(api.refreshGameMetadata?.('g1')).resolves.toEqual(summary);
    await expect(api.selectGameMetadataCandidate?.('g1', 'vndb', 'v17')).resolves.toEqual(summary);
    expect(api.translateGameSummary).toBeTypeOf('function');
    await expect(api.translateGameSummary?.('g1', 'vndb')).resolves.toEqual(summary);
    expect(ipc.invoke).toHaveBeenNthCalledWith(1, IPC_LIBRARY_GET_GAME_METADATA, 'g1');
    expect(ipc.invoke).toHaveBeenNthCalledWith(2, IPC_LIBRARY_REFRESH_GAME_METADATA, 'g1');
    expect(ipc.invoke).toHaveBeenNthCalledWith(3, IPC_LIBRARY_SELECT_GAME_METADATA_CANDIDATE, 'g1', 'vndb', 'v17');
    expect(ipc.invoke).toHaveBeenNthCalledWith(4, IPC_LIBRARY_TRANSLATE_GAME_SUMMARY, 'g1', 'vndb');
  });
});
