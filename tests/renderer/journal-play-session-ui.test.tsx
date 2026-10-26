/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { JournalWorkspace } from '../../src/renderer/src/features/journal/JournalWorkspace';
import { createBlankJournalPage } from '../../src/renderer/src/features/journal/journal-model';
import type { ReinaEnvelope, ReinaLink, ReinaSession, ReinaStats } from '../../src/shared/reina';
import type { Game, JournalPage, JournalPlaySessionBlock, Track } from '../../src/shared/types';

const game: Game = {
  id: 'game-1', name: 'ATRI', coverPath: null, coverSource: null, folderPath: 'C:/Music/ATRI', trackCount: 1,
  createdAt: '', updatedAt: '',
};

const otherGame: Game = {
  id: 'game-2', name: 'Summer Pockets', coverPath: null, coverSource: null, folderPath: 'C:/Music/Summer', trackCount: 0,
  createdAt: '', updatedAt: '',
};

const track: Track = {
  id: 'track-1', gameId: game.id, gameName: game.name, filePath: 'C:/Music/ATRI/theme.ogg', fileName: 'theme.ogg',
  customName: null, displayName: 'Dear Moments', duration: 180, kind: 'music', format: 'ogg', fileSize: 1,
  fileHash: 'hash', trackNumber: 1, isFavorite: false, createdAt: '', updatedAt: '',
};

const sessionA: ReinaSession = {
  id: 1, gameId: 42,
  startTime: '2026-10-18T21:00:00+08:00', endTime: '2026-10-18T21:30:00+08:00', sourceDate: '2026-10-18',
  recordedMinutes: 30, recordedDurationSeconds: 1800,
  durationPrecision: 'minute-rounded', trackingMode: 'unknown', recordKind: 'unknown',
};

const sessionB: ReinaSession = {
  id: 2, gameId: 42,
  startTime: '2026-10-20T23:00:00+08:00', endTime: '2026-10-20T23:45:00+08:00', sourceDate: '2026-10-20',
  recordedMinutes: 45, recordedDurationSeconds: 2700,
  durationPrecision: 'minute-rounded', trackingMode: 'unknown', recordKind: 'unknown',
};

const link: ReinaLink = {
  localGameId: game.id,
  sourceId: 'reina-main',
  externalGameId: 42,
  externalName: 'ATRI -My Dear Moments-',
};

const stats: ReinaStats = {
  sourceTotalMinutes: 6000,
  sourceSessionCount: 80,
  sourceLastPlayed: '2026-10-20T23:45:00+08:00',
  sessionTotalMinutes: 75,
  sessionCount: 2,
  liveSession: false,
};

function envelope<T>(data: T, overrides: Partial<ReinaEnvelope<T>> = {}): ReinaEnvelope<T> {
  return {
    contractVersion: 1,
    sourceApp: 'ReinaManager',
    sourceId: 'reina-main',
    snapshotId: 'snap-1',
    fetchedAt: '2026-10-21T09:00:00+08:00',
    warnings: [],
    data,
    nextCursor: null,
    ...overrides,
  };
}

function createPage(): JournalPage {
  return createBlankJournalPage(game.id, 'page-1', '初见');
}

function createApi(page: JournalPage) {
  return {
    getJournalPages: vi.fn().mockResolvedValue([page]),
    getJournalAssets: vi.fn().mockResolvedValue([]),
    getGameMetadata: vi.fn(),
    saveJournalPage: vi.fn().mockImplementation(async (draft: JournalPage) => ({ ...page, ...draft, revision: draft.revision + 1, updatedAt: '' })),
    createJournalPage: vi.fn(),
    deleteJournalPage: vi.fn(),
    refreshGameMetadata: vi.fn(),
    selectJournalMedia: vi.fn(),
    reinaLinks: vi.fn().mockImplementation(async (localGameId: string) => (localGameId === game.id ? [link] : [])),
    reinaQuery: vi.fn().mockImplementation(async (tool: string, _query: unknown) => (
      tool === 'reina_get_stats' ? envelope(stats) : envelope([sessionA, sessionB])
    )),
  };
}

async function renderWorkspace(target: Game = game) {
  const view = render(<JournalWorkspace game={target} tracks={[track]} onPlayTrack={vi.fn()} onSeekTo={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: '切换属性面板' }));
  return view;
}

function savedPlayCard(api: ReturnType<typeof createApi>): JournalPlaySessionBlock {
  const draft = api.saveJournalPage.mock.calls.at(-1)?.[0] as JournalPage | undefined;
  const card = draft?.blocks.find((block): block is JournalPlaySessionBlock => block.type === 'play-session');
  if (!card) throw new Error('play-session card was not saved');
  return card;
}

describe('JournalWorkspace play-session picker', () => {
  // Vitest runs without globals here, so Testing Library cannot auto-clean; without
  // this each case would query stale DOM from the previous workspace render.
  afterEach(() => cleanup());

  it('inserts a historical card from one snapshot and persists the frozen payload', async () => {
    const api = createApi(createPage());
    Object.defineProperty(window, 'galMusic', { configurable: true, value: api });

    await renderWorkspace();

    const insertButton = await screen.findByRole('button', { name: /插入卡片（2）/ });
    expect(screen.getByLabelText('选择 2026-10-20 23:00–23:45 的游玩记录')).toBeChecked();
    expect(screen.getByText('只统计游玩记录，不含音乐时长。')).toBeInTheDocument();

    fireEvent.click(insertButton);

    await waitFor(() => expect(api.saveJournalPage).toHaveBeenCalled(), { timeout: 3000 });
    const card = savedPlayCard(api);

    expect(Object.keys(card.snapshot)).toEqual(['version', 'sourceApp', 'sourceId', 'externalGameId', 'externalGameName', 'fetchedAt', 'sessions', 'stats']);
    expect(card.snapshot).toMatchObject({
      version: 1,
      sourceApp: 'ReinaManager',
      sourceId: 'reina-main',
      externalGameId: 42,
      externalGameName: 'ATRI -My Dear Moments-',
      fetchedAt: '2026-10-21T09:00:00+08:00',
    });
    expect(card.snapshot.sessions.map((session) => session.id)).toEqual([2, 1]);
    expect(card.snapshot.stats).toMatchObject({ sessionCount: 2, sessionTotalMinutes: 75, liveSession: false, sourceTotalMinutes: 6000 });

    const canvasCard = document.querySelector('.journal-block--play-session');
    expect(canvasCard).not.toBeNull();
    expect(within(canvasCard as HTMLElement).getByText('ATRI -My Dear Moments-')).toBeInTheDocument();
    expect(within(canvasCard as HTMLElement).getByText('1 小时 15 分钟')).toBeInTheDocument();
    expect(within(canvasCard as HTMLElement).getByText(/截至 2026-10-21 09:00/)).toBeInTheDocument();

    const statsCall = api.reinaQuery.mock.calls.find(([tool]) => tool === 'reina_get_stats');
    const sessionsCall = api.reinaQuery.mock.calls.find(([tool]) => tool === 'reina_list_sessions');
    expect(statsCall?.[1]).toEqual({ sourceId: 'reina-main', gameId: 42 });
    expect(sessionsCall?.[1]).toMatchObject({ sourceId: 'reina-main', gameId: 42, snapshotId: 'snap-1', limit: 20 });
    expect(api.reinaQuery.mock.calls[0][0]).toBe('reina_get_stats');
  });

  it('inserts only the sessions the user keeps selected', async () => {
    const api = createApi(createPage());
    Object.defineProperty(window, 'galMusic', { configurable: true, value: api });

    await renderWorkspace();

    const picker = await screen.findByRole('region', { name: '游玩记录' });
    const olderSession = await within(picker).findByLabelText('选择 2026-10-18 21:00–21:30 的游玩记录');
    expect(olderSession).toBeChecked();
    fireEvent.click(olderSession);
    expect(olderSession).not.toBeChecked();
    expect(within(picker).getByLabelText('选择 2026-10-20 23:00–23:45 的游玩记录')).toBeChecked();
    fireEvent.click(within(picker).getByRole('button', { name: /插入卡片（1）/ }));

    await waitFor(() => expect(api.saveJournalPage).toHaveBeenCalled(), { timeout: 3000 });
    const card = savedPlayCard(api);
    expect(card.snapshot.sessions.map((session) => session.id)).toEqual([2]);
    expect(card.snapshot.stats).toMatchObject({ sessionCount: 1, sessionTotalMinutes: 45, liveSession: false });
  });

  it('shows the unbound state when Reina has no confirmed link', async () => {
    const api = createApi(createPage());
    Object.defineProperty(window, 'galMusic', { configurable: true, value: api });

    await renderWorkspace(otherGame);

    expect(await screen.findByText('尚未绑定 Reina 来源，先在设置中完成绑定。')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /插入卡片/ })).toHaveLength(0);
    expect(api.reinaQuery).not.toHaveBeenCalled();
  });

  it('keeps a failure state and retries the play-session query', async () => {
    const page = createPage();
    let statsAttempts = 0;
    const api = {
      ...createApi(page),
      reinaQuery: vi.fn().mockImplementation(async (tool: string) => {
        if (tool === 'reina_get_stats') {
          statsAttempts += 1;
          if (statsAttempts === 1) throw new Error('Reina 离线');
          return envelope(stats);
        }
        return envelope([sessionA]);
      }),
    };
    Object.defineProperty(window, 'galMusic', { configurable: true, value: api });

    await renderWorkspace();

    expect(await screen.findByText('读取游玩记录失败：Reina 离线')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('button', { name: /插入卡片（1）/ })).toBeInTheDocument();
  });

  it('drops a late response from the previous game instead of overwriting the picker', async () => {
    const page = createPage();
    let resolveSessions: ((value: ReinaEnvelope<ReinaSession[]>) => void) | null = null;
    const sessionsPromise = new Promise<ReinaEnvelope<ReinaSession[]>>((resolve) => {
      resolveSessions = resolve;
    });
    const api = {
      ...createApi(page),
      reinaQuery: vi.fn().mockImplementation((tool: string) => (
        tool === 'reina_get_stats' ? Promise.resolve(envelope(stats)) : sessionsPromise
      )),
    };
    Object.defineProperty(window, 'galMusic', { configurable: true, value: api });

    const { rerender } = await renderWorkspace();
    expect(await screen.findByText('读取游玩记录…')).toBeInTheDocument();

    rerender(<JournalWorkspace game={otherGame} tracks={[track]} onPlayTrack={vi.fn()} onSeekTo={vi.fn()} />);
    expect(await screen.findByText('尚未绑定 Reina 来源，先在设置中完成绑定。')).toBeInTheDocument();

    await act(async () => {
      resolveSessions?.(envelope([sessionA, sessionB]));
      await Promise.resolve();
    });

    expect(screen.queryAllByText('2026-10-20')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(document.querySelector('.journal-block--play-session')).toBeNull();
  });

  it('ignores a stale paged response without clearing the new source loading state', async () => {
    const page = createPage();
    const secondLink: ReinaLink = {
      localGameId: game.id,
      sourceId: 'reina-two',
      externalGameId: 42,
      externalName: 'ATRI (second source)',
    };
    const staleSession: ReinaSession = {
      ...sessionA,
      id: 9,
      startTime: '2026-10-25T20:00:00+08:00',
      endTime: '2026-10-25T20:30:00+08:00',
      sourceDate: '2026-10-25',
    };
    const deferred: Record<string, (value: ReinaEnvelope<ReinaSession[]>) => void> = {};
    const paged = (key: string) => new Promise<ReinaEnvelope<ReinaSession[]>>((resolve) => {
      deferred[key] = resolve;
    });
    const api = {
      ...createApi(page),
      reinaLinks: vi.fn().mockResolvedValue([link, secondLink]),
      reinaQuery: vi.fn().mockImplementation((tool: string, query: { sourceId: string; cursor?: string }) => {
        if (tool === 'reina_get_stats') return Promise.resolve(envelope(stats));
        if (query.cursor === 'cursor-a') return paged('a');
        if (query.cursor === 'cursor-b') return paged('b');
        return Promise.resolve(envelope(query.sourceId === 'reina-main' ? [sessionA] : [sessionB], {
          nextCursor: query.sourceId === 'reina-main' ? 'cursor-a' : 'cursor-b',
        }));
      }),
    };
    Object.defineProperty(window, 'galMusic', { configurable: true, value: api });

    await renderWorkspace();
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));

    // Switch source while the first page request is still in flight.
    fireEvent.change(screen.getByLabelText('选择 Reina 绑定来源'), { target: { value: 'reina-two\u000042' } });
    expect(await screen.findByText('2026-10-20')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    expect(screen.getByText('加载中…')).toBeInTheDocument();

    await act(async () => {
      deferred.a?.(envelope([staleSession], { nextCursor: 'cursor-a2' }));
      await Promise.resolve();
    });
    expect(screen.queryByText('2026-10-25')).toBeNull();
    // The stale request's `finally` must not clear the newer request's flag.
    expect(screen.getByText('加载中…')).toBeInTheDocument();

    await act(async () => {
      deferred.b?.(envelope([sessionB], { nextCursor: 'cursor-b2' }));
      await Promise.resolve();
    });
    expect(await screen.findByRole('button', { name: '加载更多' })).toBeInTheDocument();
    expect(screen.queryByText('2026-10-25')).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });
});
