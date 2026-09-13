/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { JournalWorkspace } from '../../src/renderer/src/features/journal/JournalWorkspace';
import { createBlankJournalPage } from '../../src/renderer/src/features/journal/journal-model';
import type { Game, Track } from '../../src/shared/types';

const game: Game = {
  id: 'game-1', name: 'ATRI', coverPath: null, coverSource: null, folderPath: 'C:/Music/ATRI', trackCount: 1,
  createdAt: '', updatedAt: '',
};

const track: Track = {
  id: 'track-1', gameId: game.id, gameName: game.name, filePath: 'C:/Music/ATRI/theme.ogg', fileName: 'theme.ogg',
  customName: null, displayName: 'Dear Moments', duration: 180, kind: 'music', format: 'ogg', fileSize: 1,
  fileHash: 'hash', trackNumber: 1, isFavorite: false, createdAt: '', updatedAt: '',
};

describe('JournalWorkspace', () => {
  it('loads a page, adds a memory card and saves the edited page through the bridge', async () => {
    const page = createBlankJournalPage(game.id, 'page-1', '初见');
    const api = {
      getJournalPages: vi.fn().mockResolvedValue([page]),
      getJournalAssets: vi.fn().mockResolvedValue([]),
      getGameMetadata: vi.fn().mockResolvedValue({ gameId: game.id, coverSource: null, sources: [] }),
      saveJournalPage: vi.fn().mockImplementation(async (draft) => ({ ...page, ...draft, revision: draft.revision + 1, updatedAt: '' })),
      createJournalPage: vi.fn(),
      deleteJournalPage: vi.fn(),
      refreshGameMetadata: vi.fn(),
      selectJournalMedia: vi.fn(),
    };
    Object.defineProperty(window, 'galMusic', { configurable: true, value: api });

    render(<JournalWorkspace game={game} tracks={[track]} onPlayTrack={vi.fn()} onSeekTo={vi.fn()} />);

    expect(await screen.findByLabelText('手账页面标题')).toHaveValue('初见');
    expect(screen.queryByRole('button', { name: '详情' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刷新详情' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '便签' }));
    expect(await screen.findByPlaceholderText('写下此刻…')).toBeInTheDocument();
    expect(api.getGameMetadata).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('手账页面标题'), { target: { value: '初见 · 主题曲' } });
    await waitFor(() => expect(api.saveJournalPage).toHaveBeenCalled());
    expect(api.saveJournalPage.mock.calls.at(-1)?.[0]).toMatchObject({ title: '初见 · 主题曲' });
  });
});
