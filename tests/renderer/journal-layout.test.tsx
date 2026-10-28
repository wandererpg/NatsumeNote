/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { JournalWorkspace } from '../../src/renderer/src/features/journal/JournalWorkspace';
import { createBlankJournalPage } from '../../src/renderer/src/features/journal/journal-model';
import type { Game } from '../../src/shared/types';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('keeps small-window editing readable, preserves manual zoom and offers whole-paper fit', async () => {
  let onResize: (() => void) | null = null;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { onResize = callback; }
    observe() {}
    disconnect() { onResize = null; }
  });
  const game: Game = { id: 'game', name: 'ATRI', coverPath: null, coverSource: null, folderPath: 'C:/synthetic', trackCount: 0, createdAt: '', updatedAt: '' };
  Object.defineProperty(window, 'galMusic', { configurable: true, value: {
    getJournalPages: async () => [createBlankJournalPage(game.id, 'page', '初见')],
    getJournalAssets: async () => [],
  } });
  const view = render(<JournalWorkspace game={game} tracks={[]} onPlayTrack={vi.fn()} onSeekTo={vi.fn()} />);
  await screen.findByLabelText('手账页面标题');
  const viewport = view.container.querySelector('.journal-canvas-viewport')!;
  let width = 640;
  let height = 480;
  Object.defineProperties(viewport, { clientWidth: { get: () => width }, clientHeight: { get: () => height } });
  act(() => onResize?.());
  expect(screen.getByLabelText('画布缩放')).toHaveTextContent('75%');
  fireEvent.click(screen.getByRole('button', { name: '放大画布' }));
  expect(screen.getByLabelText('画布缩放')).toHaveTextContent('85%');
  width = 400; height = 300;
  act(() => onResize?.());
  expect(screen.getByLabelText('画布缩放')).toHaveTextContent('85%');
  fireEvent.click(screen.getByRole('button', { name: '适应窗口' }));
  expect(screen.getByLabelText('画布缩放')).toHaveTextContent('35%');
});
