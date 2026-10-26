/** @vitest-environment jsdom */
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackKindFilter } from '../../src/renderer/src/components/library/TrackKindFilter';
import { GameList } from '../../src/renderer/src/components/library/GameList';
import App from '../../src/renderer/src/App';
import { useLibraryStore } from '../../src/renderer/src/stores/libraryStore';
import { usePlayerStore } from '../../src/renderer/src/stores/playerStore';
import { useUiStore } from '../../src/renderer/src/stores/uiStore';
import type { Game, Track, TrackKind } from '../../src/shared/types';

const games: Game[] = ['one', 'two'].map(id => ({
  id, name: `Game ${id}`, coverPath: null, coverSource: null, trackCount: 2, createdAt: '', updatedAt: '',
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('library switching feedback', () => {
  it('follows rapid filter changes immediately and restores selection on remount', () => {
    const changed = vi.fn();
    function Filter() {
      const [value, setValue] = useState<TrackKind | null>(null);
      return <TrackKindFilter value={value} onChange={next => { changed(next); setValue(next); }} />;
    }
    const { container, unmount } = render(<Filter />);
    fireEvent.click(screen.getByRole('button', { name: '音乐' }));
    fireEvent.click(screen.getByRole('button', { name: '语音' }));
    expect(screen.getByRole('button', { name: '语音' })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.track-kind-filter__selection')).toHaveStyle({ transform: 'translateX(200%)' });
    fireEvent.click(screen.getByRole('button', { name: '语音' }));
    expect(changed.mock.calls).toEqual([['music'], ['voice'], ['voice']]);
    unmount();
    const next = render(<TrackKindFilter value="music" onChange={changed} />);
    expect(next.container.querySelector('.track-kind-filter__selection')).toHaveStyle({ transform: 'translateX(100%)' });
  });

  it('positions folder selection relative to the list, including reordered nested rows', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const list = this.closest('.game-list');
      const rows = list ? [...list.querySelectorAll('.game-list__item')] : [];
      const index = rows.indexOf(this);
      return { left: 20, top: 100 + Math.max(0, index) * 69, width: 200, height: 66 } as DOMRect;
    });
    const { container, rerender } = render(<GameList games={games} selectedGameId="two" />);
    const indicator = container.querySelector('.selection-indicator');
    expect(indicator).toHaveStyle({ transform: 'translate(0px, 69px)', opacity: '1' });
    rerender(<GameList games={[games[1], games[0]]} selectedGameId="two" />);
    expect(indicator).toHaveStyle({ transform: 'translate(0px, 0px)' });
    rerender(<GameList games={games} selectedGameId={null} />);
    expect(indicator).toHaveStyle({ opacity: '0' });
  });

  it('reveals results only when the latest filter finishes and keeps the surface on track edits', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    useLibraryStore.getState().reset();
    usePlayerStore.getState().reset();
    useUiStore.getState().reset();
    let finishMusic!: (tracks: Track[]) => void;
    let finishVoice!: (tracks: Track[]) => void;
    const getTracks = vi.fn(async (query) => {
      if (query.kind === 'music') return new Promise<Track[]>(resolve => { finishMusic = resolve; });
      if (query.kind === 'voice') return new Promise<Track[]>(resolve => { finishVoice = resolve; });
      return [];
    });
    window.galMusic = {
      getGames: vi.fn().mockResolvedValue(games), getPlaylists: vi.fn().mockResolvedValue([]), getTracks,
      getSettings: vi.fn().mockResolvedValue({ libraryPath: 'C:/Music' }),
      getGameMetadata: vi.fn(async (id: string) => ({ gameId: id, coverSource: null, sources: [] })),
      setSetting: vi.fn().mockResolvedValue(undefined),
    } as unknown as typeof window.galMusic;
    const { container } = render(<App />);
    fireEvent.click(await screen.findByTestId('game-item-one'));
    fireEvent.click(await screen.findByRole('button', { name: '打开音乐空间' }));
    const group = screen.getByRole('group', { name: '曲目分类' });
    fireEvent.click(within(group).getByRole('button', { name: '音乐' }));
    fireEvent.click(within(group).getByRole('button', { name: '语音' }));
    await waitFor(() => expect(finishVoice).toBeTypeOf('function'));
    expect(container.querySelector('.track-results')).toHaveAttribute('data-ready', 'false');
    expect(screen.getByRole('status', { name: '正在读取曲目' })).toBeInTheDocument();
    const track = {
      id: 'voice', gameId: 'one', filePath: 'C:/Music/voice.ogg', fileName: 'voice.ogg',
      displayName: 'Latest voice', customName: null, kind: 'voice', duration: 8, format: 'ogg',
      fileSize: 1, fileHash: 'hash', trackNumber: 1, isFavorite: false, createdAt: '', updatedAt: '',
    } satisfies Track;
    await act(async () => { finishVoice([track]); });
    expect(await screen.findByText('Latest voice')).toBeInTheDocument();
    const results = container.querySelector('.track-results');
    expect(results).toHaveAttribute('data-ready', 'true');
    await act(async () => { finishMusic([]); });
    expect(screen.getByText('Latest voice')).toBeInTheDocument();
    act(() => useLibraryStore.setState({ tracks: [{ ...track, isFavorite: true }] }));
    expect(container.querySelector('.track-results')).toBe(results);
  });
});
