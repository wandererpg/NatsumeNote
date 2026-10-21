/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useGameTagFilter } from '../../src/renderer/src/hooks/useGameTagFilter';
import type { GalMusicAPI } from '../../src/shared/ipc';
import type { Game } from '../../src/shared/types';
const games = ['a','b'].map(id => ({id,name:id,trackCount:0,coverPath:null,createdAt:'',updatedAt:''})) as Game[];
afterEach(() => { cleanup(); delete (window as unknown as {galMusic?:GalMusicAPI}).galMusic; });
it('uses whole-library AND queries, discards older responses and retains results during refresh', async () => {
  let resolveOld!: (games: Game[]) => void;
  const filter = vi.fn().mockImplementation((tags: string[]) => tags.length === 1 ? new Promise<Game[]>(resolve => { resolveOld=resolve; }) : Promise.resolve([games[1]]));
  window.galMusic = {getGameTags: vi.fn().mockResolvedValue([{name:'剧情',provider:'vndb'},{name:'校园',provider:'bangumi'}]),filterGamesByTags:filter} as unknown as GalMusicAPI;
  const {result} = renderHook(() => useGameTagFilter(games));
  await waitFor(()=>expect(result.current.loading).toBe(false));
  act(()=>result.current.toggle('vndb:剧情'));
  await waitFor(()=>expect(filter).toHaveBeenCalledWith(['vndb:剧情']));
  act(()=>result.current.toggle('bangumi:校园'));
  await waitFor(()=>expect(result.current.filteredGames.map(game=>game.id)).toEqual(['b']));
  await act(async()=>resolveOld([games[0]]));
  expect(result.current.filteredGames.map(game=>game.id)).toEqual(['b']);
  act(()=>window.dispatchEvent(new Event('reina-tags-changed')));
  expect(result.current.pendingFilter).toBe(false);
  await waitFor(()=>expect(result.current.loading).toBe(false));
  act(()=>result.current.clear());
  expect(result.current.filteredGames).toEqual(games);
});
