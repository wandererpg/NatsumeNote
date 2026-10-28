/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { validateJournalPageCreate, validateJournalPageDraft } from '../../src/main/ipc/journal-validation';
import { JournalWorkspace } from '../../src/renderer/src/features/journal/JournalWorkspace';
import * as journalExport from '../../src/renderer/src/features/journal/journal-export';
import { createBlankJournalPage } from '../../src/renderer/src/features/journal/journal-model';
import type { Game, JournalAsset, JournalPage } from '../../src/shared/types';

const firstGame: Game = {
  id: 'first-game', name: 'ATRI', coverPath: null, coverSource: null, folderPath: 'C:/Music/ATRI',
  trackCount: 0, createdAt: '', updatedAt: '',
};
const secondGame: Game = { ...firstGame, id: 'second-game', name: 'Summer Pockets', folderPath: 'C:/Music/SummerPockets' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

function imageAsset(game: Game): JournalAsset {
  return {
    id: `${game.id}-image`, gameId: game.id, kind: 'image', filePath: `${game.folderPath}/image.png`,
    fileName: `${game.name}.png`, mimeType: 'image/png', fileSize: 1, fileHash: game.id, createdAt: '',
  };
}

function setup(options: { secondPage?: boolean; secondAssets?: JournalAsset[] } = {}) {
  const firstPage = createBlankJournalPage(firstGame.id, 'first-page', '旧作品第一页');
  const secondPage = createBlankJournalPage(secondGame.id, 'second-page', '新作品第一页');
  const oldPages = options.secondPage
    ? [firstPage, createBlankJournalPage(firstGame.id, 'old-extra-page', '旧作品第二页')]
    : [firstPage];
  const pages = new Map([...oldPages, secondPage].map(page => [page.id, page]));
  const api = {
    getJournalPages: vi.fn(async (gameId: string) => gameId === firstGame.id ? oldPages : [secondPage]),
    getJournalAssets: vi.fn(async (gameId: string) => gameId === secondGame.id ? options.secondAssets ?? [] : []),
    saveJournalPage: vi.fn(async (input: unknown) => {
      const draft = validateJournalPageDraft(input);
      const saved = { ...pages.get(draft.id)!, ...draft, revision: draft.revision + 1 };
      pages.set(saved.id, saved);
      return saved;
    }),
    createJournalPage: vi.fn(async (input: unknown) => {
      const draft = validateJournalPageCreate(input);
      return { ...createBlankJournalPage(draft.gameId, draft.id, draft.title), ...draft };
    }),
    selectJournalMedia: vi.fn(async (_gameId: string, _kind: 'image' | 'video'): Promise<JournalAsset[]> => []),
    deleteJournalPage: vi.fn(async (_pageId: string) => {}),
  };
  Object.defineProperty(window, 'galMusic', { configurable: true, value: api });
  const onPlayTrack = vi.fn();
  const onSeekTo = vi.fn();
  const workspace = (game: Game) => (
    <JournalWorkspace game={game} tracks={[]} onPlayTrack={onPlayTrack} onSeekTo={onSeekTo} />
  );
  const view = render(workspace(firstGame));
  return { api, firstPage, secondPage, switchGame: () => view.rerender(workspace(secondGame)) };
}

describe('JournalWorkspace asynchronous game changes', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('discards a page creation that finishes after another game has loaded', async () => {
    const pending = deferred<JournalPage>();
    const { api, secondPage, switchGame } = setup();
    api.createJournalPage.mockImplementationOnce(input => {
      validateJournalPageCreate(input);
      return pending.promise;
    });
    await screen.findByDisplayValue('旧作品第一页');
    fireEvent.click(screen.getByRole('button', { name: '新页面' }));
    await waitFor(() => expect(api.createJournalPage).toHaveBeenCalledTimes(1));
    const draft = validateJournalPageCreate(api.createJournalPage.mock.calls[0][0]);

    switchGame();
    await waitFor(() => expect(screen.getByLabelText('手账页面标题')).toHaveValue(secondPage.title));
    expect(screen.getByRole('button', { name: '新页面' })).toBeEnabled();
    await act(async () => {
      pending.resolve({ ...createBlankJournalPage(draft.gameId, draft.id, draft.title), ...draft });
      await pending.promise;
    });

    expect(screen.getByLabelText('手账页面标题')).toHaveValue(secondPage.title);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.queryByRole('tab', { name: /第 2 页/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('手账页面标题'), { target: { value: '新作品编辑' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.saveJournalPage).toHaveBeenCalledWith(expect.objectContaining({
      id: secondPage.id, gameId: secondGame.id, title: '新作品编辑',
    })));
  });

  it('keeps late imported assets and cards out of the next game, including its export', async () => {
    const pending = deferred<JournalAsset[]>();
    const currentAsset = imageAsset(secondGame);
    const oldAsset = imageAsset(firstGame);
    const exportSvg = vi.spyOn(journalExport, 'downloadJournalPageSvg').mockImplementation(() => {});
    const { api, secondPage, switchGame } = setup({ secondAssets: [currentAsset] });
    api.selectJournalMedia.mockReturnValueOnce(pending.promise);
    await screen.findByDisplayValue('旧作品第一页');
    fireEvent.click(screen.getByRole('button', { name: '图片' }));
    expect(api.selectJournalMedia).toHaveBeenCalledWith(firstGame.id, 'image');

    switchGame();
    await waitFor(() => expect(screen.getByLabelText('手账页面标题')).toHaveValue(secondPage.title));
    expect(screen.getByRole('button', { name: '图片' })).toBeEnabled();
    await act(async () => { pending.resolve([oldAsset]); await pending.promise; });

    expect(screen.getByLabelText('手账页面标题')).toHaveValue(secondPage.title);
    expect(screen.queryByLabelText('素材说明')).not.toBeInTheDocument();
    expect(screen.queryByText(/已导入/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('导出'));
    fireEvent.click(screen.getByRole('button', { name: '导出 SVG' }));
    expect(exportSvg).toHaveBeenCalledWith(
      expect.objectContaining({ id: secondPage.id, gameId: secondGame.id, blocks: [] }),
      expect.objectContaining({ gameName: secondGame.name, assets: [currentAsset] }),
    );
    expect(api.saveJournalPage).not.toHaveBeenCalled();
  });

  it('saves edits made on the current page while a new page is being created', async () => {
    const pending = deferred<JournalPage>();
    const { api, firstPage } = setup();
    api.createJournalPage.mockImplementationOnce(input => {
      validateJournalPageCreate(input);
      return pending.promise;
    });
    await screen.findByDisplayValue(firstPage.title);
    fireEvent.click(screen.getByRole('button', { name: '新页面' }));
    await waitFor(() => expect(api.createJournalPage).toHaveBeenCalledTimes(1));
    const draft = validateJournalPageCreate(api.createJournalPage.mock.calls[0][0]);
    fireEvent.change(screen.getByLabelText('手账页面标题'), { target: { value: '创建期间继续写下的回忆' } });

    await act(async () => {
      pending.resolve({ ...createBlankJournalPage(draft.gameId, draft.id, draft.title), ...draft });
      await pending.promise;
    });

    await waitFor(() => expect(screen.getByLabelText('手账页面标题')).toHaveValue(draft.title));
    expect(api.saveJournalPage).toHaveBeenCalledWith(expect.objectContaining({
      id: firstPage.id, gameId: firstGame.id, title: '创建期间继续写下的回忆',
    }));
    fireEvent.click(screen.getByRole('tab', { name: /创建期间继续写下的回忆/ }));
    await waitFor(() => expect(screen.getByLabelText('手账页面标题')).toHaveValue('创建期间继续写下的回忆'));
  });

  it('does not replace the new game pages when an old deletion completes', async () => {
    const pending = deferred<void>();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { api, firstPage, secondPage, switchGame } = setup({ secondPage: true });
    api.deleteJournalPage.mockReturnValueOnce(pending.promise);
    await screen.findByDisplayValue(firstPage.title);
    fireEvent.click(screen.getByRole('button', { name: '切换属性面板' }));
    fireEvent.click(screen.getByRole('button', { name: '删除页面' }));
    await waitFor(() => expect(api.deleteJournalPage).toHaveBeenCalledWith(firstPage.id));

    switchGame();
    await waitFor(() => expect(screen.getByLabelText('手账页面标题')).toHaveValue(secondPage.title));
    await act(async () => { pending.resolve(); await pending.promise; });

    expect(screen.getByLabelText('手账页面标题')).toHaveValue(secondPage.title);
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.queryByRole('tab', { name: /旧作品/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新页面' })).toBeEnabled();
  });
});
