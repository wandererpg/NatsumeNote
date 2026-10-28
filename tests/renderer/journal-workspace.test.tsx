/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateJournalPageCreate, validateJournalPageDraft } from '../../src/main/ipc/journal-validation';

import { JournalWorkspace } from '../../src/renderer/src/features/journal/JournalWorkspace';
import { createBlankJournalPage, createJournalTextBlock } from '../../src/renderer/src/features/journal/journal-model';
import type { Game, JournalPage, Track } from '../../src/shared/types';

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
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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

  function setup() {
    const first = { ...createBlankJournalPage(game.id, 'first', '第一页'), blocks: [createJournalTextBlock('note', 60, 150)] };
    const second = createBlankJournalPage(game.id, 'second', '第二页');
    const api = {
      getJournalPages: vi.fn().mockResolvedValue([first, second]),
      getJournalAssets: vi.fn().mockResolvedValue([]),
      saveJournalPage: vi.fn().mockImplementation(async (draft: JournalPage) => ({ ...first, ...validateJournalPageDraft(draft), revision: draft.revision + 1 })),
    };
    Object.defineProperty(window, 'galMusic', { configurable: true, value: api });
    const view = render(<JournalWorkspace game={game} tracks={[track]} onPlayTrack={vi.fn()} onSeekTo={vi.fn()} />);
    return { api, first, view };
  }

  it('saves the current edits before changing pages and keeps the page open when saving fails', async () => {
    const { api } = setup();
    const title = await screen.findByLabelText('手账页面标题');
    fireEvent.change(title, { target: { value: '还没有保存的标题' } });
    api.saveJournalPage.mockRejectedValueOnce(new Error('磁盘暂时不可用'));
    fireEvent.click(screen.getByRole('tab', { name: /第二页/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘暂时不可用');
    expect(title).toHaveValue('还没有保存的标题');
    fireEvent.click(screen.getByRole('tab', { name: /第二页/ }));
    await waitFor(() => expect(screen.getByLabelText('手账页面标题')).toHaveValue('第二页'));
    expect(api.saveJournalPage.mock.lastCall?.[0]).toMatchObject({ id: 'first', title: '还没有保存的标题' });
    fireEvent.click(screen.getByRole('tab', { name: /还没有保存的标题/ }));
    await waitFor(() => expect(screen.getByLabelText('手账页面标题')).toHaveValue('还没有保存的标题'));
  });

  it('preserves edits made while a save is in flight and saves them with the next revision', async () => {
    const { api } = setup();
    const title = await screen.findByLabelText('手账页面标题');
    let finish!: (value: JournalPage) => void;
    api.saveJournalPage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.change(title, { target: { value: '第一笔' } });
    fireEvent.keyDown(title, { key: 's', ctrlKey: true });
    fireEvent.change(title, { target: { value: '继续写下的一笔' } });
    await act(async () => { finish({ ...api.saveJournalPage.mock.calls[0][0], revision: 1 }); });
    await waitFor(() => expect(api.saveJournalPage).toHaveBeenCalledTimes(2));
    expect(api.saveJournalPage.mock.lastCall?.[0]).toMatchObject({ title: '继续写下的一笔', revision: 1 });
    expect(title).toHaveValue('继续写下的一笔');
  });

  it('focuses the destination tab after an asynchronous save finishes', async () => {
    const { api } = setup();
    const title = await screen.findByLabelText('手账页面标题');
    let finish!: (value: JournalPage) => void;
    api.saveJournalPage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.change(title, { target: { value: '切页前的编辑' } });
    const firstTab = screen.getByRole('tab', { name: /第一页/ });
    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /第二页/ })).toBeDisabled();
    await act(async () => { finish({ ...api.saveJournalPage.mock.calls[0][0], revision: 1 }); });
    expect(screen.getByRole('tab', { name: /第二页/ })).toHaveFocus();
  });

  it('flushes the latest input when leaving before autosave', async () => {
    const { api, view } = setup();
    fireEvent.change(await screen.findByLabelText('手账页面标题'), { target: { value: '离开前的最后一笔' } });
    expect(api.saveJournalPage).not.toHaveBeenCalled();
    view.unmount();
    await waitFor(() => expect(api.saveJournalPage).toHaveBeenCalledTimes(1));
    expect(api.saveJournalPage.mock.lastCall?.[0]).toMatchObject({ title: '离开前的最后一笔' });
  });

  it('recovers input if leaving-time saving fails and lets the user retry', async () => {
    const { api, view } = setup();
    fireEvent.change(await screen.findByLabelText('手账页面标题'), { target: { value: '暂时没写入磁盘的内容' } });
    api.saveJournalPage.mockRejectedValueOnce(new Error('磁盘暂时不可用'));
    view.unmount();
    render(<JournalWorkspace game={game} tracks={[track]} onPlayTrack={vi.fn()} onSeekTo={vi.fn()} />);
    expect(await screen.findByLabelText('手账页面标题')).toHaveValue('暂时没写入磁盘的内容');
    expect(screen.getByRole('alert')).toHaveTextContent('已恢复编辑');
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(api.saveJournalPage.mock.lastCall?.[0]).toMatchObject({ title: '暂时没写入磁盘的内容' });
  });

  it('finishes later typing after leaving during a save and waits before reopening the journal', async () => {
    const { api, first, view } = setup();
    const title = await screen.findByLabelText('手账页面标题');
    let finish!: (value: JournalPage) => void;
    api.saveJournalPage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.change(title, { target: { value: '正在保存的一笔' } });
    fireEvent.keyDown(title, { key: 's', ctrlKey: true });
    fireEvent.change(title, { target: { value: '离开前继续输入' } });
    view.unmount();
    api.getJournalPages.mockImplementation(async () => [{ ...first, ...api.saveJournalPage.mock.lastCall?.[0] }]);
    render(<JournalWorkspace game={game} tracks={[track]} onPlayTrack={vi.fn()} onSeekTo={vi.fn()} />);
    expect(screen.getByText('正在翻开手账')).toBeInTheDocument();
    expect(api.getJournalPages).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ ...api.saveJournalPage.mock.calls[0][0], revision: 1 }); });
    expect(await screen.findByLabelText('手账页面标题')).toHaveValue('离开前继续输入');
    expect(api.saveJournalPage.mock.lastCall?.[0]).toMatchObject({ title: '离开前继续输入', revision: 1 });
  });

  it('focuses a dragged card so Escape cancels and arrow keys work after entering from outside', async () => {
    const { api } = setup();
    await screen.findByLabelText('手账页面标题');
    vi.stubGlobal('PointerEvent', MouseEvent);
    const outside = document.createElement('button');
    document.body.append(outside); outside.focus();
    const move = screen.getByRole('button', { name: '移动便签' });
    fireEvent.pointerDown(move, { button: 0, clientX: 80, clientY: 170 });
    expect(move).toHaveFocus();
    fireEvent.pointerMove(move, { clientX: 170, clientY: 215 });
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    fireEvent.pointerUp(move);
    expect(move.closest('[data-journal-block]')).toHaveStyle({ left: '60px', top: '150px' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement!, { key: 's', ctrlKey: true });
    await waitFor(() => expect(api.saveJournalPage).toHaveBeenCalledTimes(1));
    expect(api.saveJournalPage.mock.lastCall?.[0].blocks[0]).toMatchObject({ x: 61, y: 150 });
    outside.remove();
  });

  it('resizes with the button handle, provides keyboard movement and leaves typed arrows alone', async () => {
    const { api, first } = setup();
    await screen.findByLabelText('手账页面标题');
    vi.stubGlobal('PointerEvent', MouseEvent);
    const text = screen.getByLabelText('手账文字');
    fireEvent.pointerDown(text, { button: 0, clientX: 80, clientY: 170 });
    const resize = screen.getByRole('button', { name: '调整大小' });
    fireEvent.pointerDown(resize, { button: 0, clientX: 300, clientY: 360 });
    fireEvent.pointerMove(resize, { clientX: 390, clientY: 405 });
    fireEvent.pointerUp(resize, { clientX: 390, clientY: 405 });
    const move = screen.getByRole('button', { name: '移动便签' });
    fireEvent.keyDown(move, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(text, { key: 'ArrowDown' });
    fireEvent.keyDown(move, { key: 's', ctrlKey: true });
    await waitFor(() => expect(api.saveJournalPage).toHaveBeenCalled());
    const block = api.saveJournalPage.mock.lastCall?.[0].blocks[0];
    expect(block.width).toBeGreaterThan(first.blocks[0].width);
    expect(block.height).toBeGreaterThan(first.blocks[0].height);
    expect(block).toMatchObject({ x: 70, y: 150 });
  });

  it('contains memory-mode focus, dismisses with Escape and restores focus to its trigger', async () => {
    setup();
    await screen.findByLabelText('手账页面标题');
    const trigger = screen.getByRole('button', { name: '记忆模式' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '记忆模式' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('moves relative to the original position, writes after release, and rolls cancelled drags back', async () => {
    const { api } = setup();
    await screen.findByLabelText('手账页面标题');
    vi.stubGlobal('PointerEvent', MouseEvent);
    const move = screen.getByRole('button', { name: '移动便签' });
    fireEvent.pointerDown(move, { button: 0, clientX: 80, clientY: 170 });
    fireEvent.pointerMove(move, { clientX: 170, clientY: 215 });
    expect(api.saveJournalPage).not.toHaveBeenCalled();
    fireEvent.pointerUp(move, { clientX: 170, clientY: 215 });
    fireEvent.keyDown(move, { key: 's', ctrlKey: true });
    await waitFor(() => expect(api.saveJournalPage).toHaveBeenCalledTimes(1));
    expect(api.saveJournalPage.mock.lastCall?.[0].blocks[0]).toMatchObject({ x: 160, y: 200 });
    fireEvent.pointerDown(move, { button: 0, clientX: 170, clientY: 215 });
    fireEvent.pointerMove(move, { clientX: 350, clientY: 305 });
    fireEvent.pointerCancel(move);
    fireEvent.keyDown(move, { key: 's', ctrlKey: true });
    expect(api.saveJournalPage).toHaveBeenCalledTimes(1);
    expect(move.closest('[data-journal-block]')).toHaveStyle({ left: '160px', top: '200px' });
  });

  it('creates the first page with the exact IPC contract when the journal is empty', async () => {
    const create = vi.fn().mockImplementation(async input => {
      const validated = validateJournalPageCreate(input);
      return { ...createBlankJournalPage(game.id, validated.id, validated.title), ...validated };
    });
    Object.defineProperty(window, 'galMusic', { configurable: true, value: {
      getJournalPages: async () => [], getJournalAssets: async () => [], createJournalPage: create,
    } });
    render(<JournalWorkspace game={game} tracks={[track]} onPlayTrack={vi.fn()} onSeekTo={vi.fn()} />);
    expect(await screen.findByLabelText('手账页面标题')).toHaveValue('初见 · 作品手账');
    expect(create).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
