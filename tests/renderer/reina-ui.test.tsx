/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReinaGamePanel } from '../../src/renderer/src/features/reina/ReinaGamePanel';
import { ReinaHistoryPreview } from '../../src/renderer/src/features/reina/ReinaHistoryPreview';
import { ReinaBatchImportPanel } from '../../src/renderer/src/features/reina/ReinaBatchImportPanel';
import type { ReinaBatchPreview } from '../../src/shared/reina';
import { TagChips } from '../../src/renderer/src/features/reina/TagChips';
import { useReinaSessions } from '../../src/renderer/src/features/reina/useReinaSessions';
import type {
  ReinaEnvelope,
  ReinaGame,
  ReinaLink,
  ReinaSession,
  ReinaSource,
  ReinaStats,
  ReinaTag,
} from '../../src/shared/reina';

// TagChips selection values are the shared `provider:name` keys.
function installBridge(api: object): void {
  Object.defineProperty(window, 'galMusic', { configurable: true, value: api });
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { galMusic?: unknown }).galMusic;
});

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

function makeStats(overrides: Partial<ReinaStats> = {}): ReinaStats {
  return {
    sourceTotalMinutes: 6000,
    sourceSessionCount: 80,
    sourceLastPlayed: '2026-10-20T23:45:00+08:00',
    sessionTotalMinutes: 30,
    sessionCount: 1,
    liveSession: false,
    ...overrides,
  };
}

function makeSession(id: number, minutes = 30): ReinaSession {
  return {
    id,
    gameId: 42,
    startTime: '2026-10-18T21:00:00+08:00',
    endTime: '2026-10-18T21:30:00+08:00',
    sourceDate: '2026-10-18',
    recordedMinutes: minutes,
    recordedDurationSeconds: minutes * 60,
    durationPrecision: 'minute-rounded',
    trackingMode: 'unknown',
    recordKind: 'unknown',
  };
}

const source: ReinaSource = {
  id: 'reina-main',
  label: '主数据库',
  connectedAt: '2026-10-01T00:00:00+08:00',
};

const linkedGame: ReinaLink = {
  localGameId: 'game-2',
  sourceId: 'reina-main',
  externalGameId: 77,
  externalName: 'Summer Pockets Link',
};

function makeGameApi(overrides: Record<string, unknown> = {}) {
  return {
    reinaSources: vi.fn().mockResolvedValue([source]),
    reinaLinks: vi.fn().mockResolvedValue([]),
    reinaQuery: vi.fn().mockImplementation(async (tool: string) => (
      tool === 'reina_get_stats' ? envelope(makeStats()) : envelope([makeSession(1)])
    )),
    ...overrides,
  };
}

function batchPreview(): ReinaBatchPreview {
  return { token: 'batch-token', libraryPath: 'D:/Music', warnings: [],
    localGames: [{ id: 'local', name: '已有作品' }, { id: 'manual', name: '手动匹配作品' }],
    rows: [
      { externalGameId: 1, name: '来源同名作品', action: 'review', reason: '存在多个匹配', alreadyLinked: false, newName: '来源同名作品' },
      { externalGameId: 2, name: '来源新作品', action: 'create', reason: '新建', alreadyLinked: false, newName: '来源新作品' },
    ] };
}
describe('Reina batch import', () => {
  it('waits for manual matching, submits only explicit decisions and refreshes the library', async () => {
    const api = { reinaBatchPreview: vi.fn().mockResolvedValue(batchPreview()), reinaBatchApply: vi.fn().mockResolvedValue({ created: 1, linked: 1, skipped: 0 }), getGames: vi.fn().mockResolvedValue([]) };
    installBridge(api);
    render(<ReinaBatchImportPanel sourceId="reina-main" />);
    fireEvent.click(screen.getByRole('button', { name: '预览并导入全部作品' }));
    await screen.findByRole('combobox', { name: '匹配 来源同名作品（1）' });
    expect((screen.getByRole('button', { name: '确认导入 1 部作品' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: '匹配 来源同名作品（1）' }), { target: { value: 'link:manual' } });
    fireEvent.click(screen.getByRole('button', { name: '确认导入 2 部作品' }));
    await screen.findByText(/导入完成：新建 1 部，关联 1 部/);
    expect(api.reinaBatchApply).toHaveBeenCalledWith('batch-token', [{ externalGameId: 1, action: 'link', localGameId: 'manual' }, { externalGameId: 2, action: 'create' }]);
    expect(api.getGames).toHaveBeenCalledOnce();
  });
  it('shows loading/errors with a retry and prevents duplicate manual targets', async () => {
    let reject!: (error: Error) => void;
    const api = { reinaBatchPreview: vi.fn().mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValue(batchPreview()), reinaBatchApply: vi.fn() };
    installBridge(api);
    render(<ReinaBatchImportPanel sourceId="reina-main" />);
    fireEvent.click(screen.getByRole('button', { name: '预览并导入全部作品' }));
    expect((screen.getByRole('button', { name: '正在读取全部作品…' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { reject(new Error('无法读取来源')); });
    expect(screen.getByRole('alert').textContent).toContain('无法读取来源');
    fireEvent.click(screen.getByRole('button', { name: '预览并导入全部作品' }));
    await screen.findByRole('combobox', { name: '匹配 来源同名作品（1）' });
    fireEvent.change(screen.getByRole('combobox', { name: '匹配 来源同名作品（1）' }), { target: { value: 'link:local' } });
    fireEvent.change(screen.getByRole('combobox', { name: '匹配 来源新作品（2）' }), { target: { value: 'link:local' } });
    expect(screen.getByRole('alert').textContent).toContain('多个来源作品');
    expect((screen.getByRole('button', { name: '确认导入 2 部作品' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.reinaBatchApply).not.toHaveBeenCalled();
  });
  it('can cancel a preview without saving and paginates all source games', async () => {
    const preview = batchPreview();
    preview.rows = Array.from({ length: 28 }, (_, index) => ({ ...preview.rows[1], externalGameId: index + 1, name: `作品${index + 1}` }));
    const api = { reinaBatchPreview: vi.fn().mockResolvedValue(preview), reinaBatchApply: vi.fn() };
    installBridge(api);
    render(<ReinaBatchImportPanel sourceId="reina-main" />);
    fireEvent.click(screen.getByRole('button', { name: '预览并导入全部作品' }));
    await screen.findByText(/共 28 部/);
    expect(screen.getAllByRole('combobox')).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getAllByRole('combobox')).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(api.reinaBatchApply).not.toHaveBeenCalled();
  });
  it('requires explicit reconfirmation of stale links and can restore a skipped original link', async () => {
    const preview = batchPreview();
    preview.rows = [{ ...preview.rows[0], alreadyLinked: true, localGameId: 'local' }];
    preview.localGames[0].boundExternalGameId = 1;
    const api = { reinaBatchPreview: vi.fn().mockResolvedValue(preview), reinaBatchApply: vi.fn().mockRejectedValue(new Error('导入预览已失效，请重新预览。')) };
    installBridge(api);
    render(<ReinaBatchImportPanel sourceId="reina-main" />);
    fireEvent.click(screen.getByRole('button', { name: '预览并导入全部作品' }));
    const select = await screen.findByRole('combobox', { name: '匹配 来源同名作品（1）' });
    expect((screen.getByRole('button', { name: '确认导入 0 部作品' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(select).queryByRole('option', { name: '新建作品及文件夹' })).toBeNull();
    fireEvent.change(select, { target: { value: 'skip' } });
    fireEvent.change(select, { target: { value: 'link:local' } });
    fireEvent.click(screen.getByRole('button', { name: '确认导入 1 部作品' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('重新预览');
    expect(api.reinaBatchApply).toHaveBeenCalledWith('batch-token', [{ externalGameId: 1, action: 'link', localGameId: 'local' }]);
  });
});

describe('TagChips', () => {
  it('removes an invalid key again after the provider tag has reappeared', () => {
    const onToggle = vi.fn();
    const selected = ['vndb:剧情'];
    const view = render(<TagChips tags={[]} selected={selected} onToggle={onToggle} />);
    expect(onToggle).toHaveBeenCalledWith('vndb:剧情');
    expect(onToggle).toHaveBeenCalledTimes(1);
    view.rerender(<TagChips tags={[{ name: '剧情', provider: 'vndb' }]} selected={selected} onToggle={onToggle} />);
    view.rerender(<TagChips tags={[]} selected={selected} onToggle={onToggle} />);
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenLastCalledWith('vndb:剧情');
  });

  it('collapses to 12 provider-specific chips, dedupes exact pairs, and toggles keys', () => {
    const tags: ReinaTag[] = Array.from({ length: 15 }, (_, index) => ({
      name: `标签${index + 1}`,
      provider: index % 2 === 0 ? 'vndb' : 'bangumi',
    }));
    // Exact (provider, name) duplicates dedupe; the same text from another
    // provider remains a separate chip with its own key.
    tags.push({ name: '标签1', provider: 'vndb' });
    tags.push({ name: '共同标签', provider: 'vndb' }, { name: '共同标签', provider: 'bangumi' });
    const onToggle = vi.fn();

    render(<TagChips tags={tags} selected={['vndb:标签1']} onToggle={onToggle} />);

    expect(screen.getAllByRole('button', { name: /^标签\d+ · (VNDB|Bangumi)$/ })).toHaveLength(12);
    expect(screen.getAllByRole('button', { name: '标签1 · VNDB' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '标签1 · VNDB' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/多选为 AND（需同时满足）/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '标签2 · Bangumi' }));
    expect(onToggle).toHaveBeenCalledWith('bangumi:标签2');

    fireEvent.click(screen.getByRole('button', { name: /展开全部（17）/ }));
    expect(screen.getByRole('button', { name: '共同标签 · VNDB' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '共同标签 · Bangumi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '标签15 · VNDB' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起' })).toBeInTheDocument();
  });

  it('toggles the same tag name from different providers independently', () => {
    const tags: ReinaTag[] = [
      { name: '剧情', provider: 'vndb' },
      { name: '剧情', provider: 'bangumi' },
    ];
    const onToggle = vi.fn();
    const view = render(<TagChips tags={tags} selected={['vndb:剧情']} onToggle={onToggle} />);

    const vndb = screen.getByRole('button', { name: '剧情 · VNDB' });
    const bangumi = screen.getByRole('button', { name: '剧情 · Bangumi' });
    expect(vndb).toHaveAttribute('aria-pressed', 'true');
    expect(bangumi).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(bangumi);
    expect(onToggle).toHaveBeenLastCalledWith('bangumi:剧情');
    fireEvent.click(vndb);
    expect(onToggle).toHaveBeenLastCalledWith('vndb:剧情');

    view.rerender(
      <TagChips tags={tags} selected={['vndb:剧情', 'bangumi:剧情']} onToggle={onToggle} />,
    );
    expect(screen.getByRole('button', { name: '剧情 · VNDB' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '剧情 · Bangumi' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('removes an invalid selected key once and explains why', async () => {
    const onToggle = vi.fn();

    render(
      <TagChips
        tags={[{ name: '有效标签', provider: 'vndb' }]}
        selected={['vndb:有效标签', 'bangumi:已失效标签']}
        onToggle={onToggle}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '有效标签 · VNDB' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith('bangumi:已失效标签'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/有 1 个筛选条件已失效/)).toBeInTheDocument();
    expect(screen.getByText('已失效标签（Bangumi）')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByText(/筛选条件已失效/)).toBeNull();
  });
});

describe('useReinaSessions', () => {
  it('drops a late response after the source changes and notifies on refresh', async () => {
    let resolveOld: (value: ReinaEnvelope<ReinaStats>) => void = () => undefined;
    const oldResponse = new Promise<ReinaEnvelope<ReinaStats>>((resolve) => {
      resolveOld = resolve;
    });
    const query = vi.fn().mockImplementation(async (tool: string, input: { sourceId: string }) => {
      if (input.sourceId === 'source-1') return oldResponse;
      return tool === 'reina_get_stats'
        ? envelope(makeStats({ sessionCount: 2, sessionTotalMinutes: 70 }), { sourceId: 'source-2' })
        : envelope([makeSession(2)], { sourceId: 'source-2' });
    });
    installBridge({ reinaQuery: query });

    const { result, rerender } = renderHook(
      ({ sourceId }: { sourceId: string }) => useReinaSessions({ sourceId, gameId: 7 }),
      { initialProps: { sourceId: 'source-1' } },
    );

    await waitFor(() => expect(query).toHaveBeenCalled());
    rerender({ sourceId: 'source-2' });
    await waitFor(() => expect(result.current.stats?.sessionCount).toBe(2));

    await act(async () => {
      resolveOld(envelope(makeStats({ sessionCount: 9 }), { sourceId: 'source-1' }));
      await Promise.resolve();
    });
    expect(result.current.stats?.sessionCount).toBe(2);

    const listener = vi.fn();
    window.addEventListener('reina-tags-changed', listener);
    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    window.removeEventListener('reina-tags-changed', listener);
  });
});

describe('ReinaHistoryPreview', () => {
  it('keeps lifetime totals even when no detailed sessions are available', async () => {
    installBridge({ reinaQuery: vi.fn().mockResolvedValue(envelope(makeStats({ sessionCount: 0, sessionTotalMinutes: 0 }))) });
    render(<ReinaHistoryPreview sourceId={source.id} gameId={42} />);
    expect(await screen.findByText('100 小时')).toBeInTheDocument();
    expect(screen.getByText(/已保存会话合计 0 分钟/)).toBeInTheDocument();
  });

  it('retries failures and shows missing lifetime totals as unavailable', async () => {
    const query = vi.fn()
      .mockRejectedValueOnce(new Error('数据库暂忙'))
      .mockResolvedValueOnce(envelope(makeStats({ sourceTotalMinutes: null, sourceSessionCount: null })));
    installBridge({ reinaQuery: query });
    render(<ReinaHistoryPreview sourceId={source.id} gameId={42} />);
    expect(await screen.findByText('数据库暂忙')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试预览' }));
    expect(await screen.findByText('来源未提供')).toBeInTheDocument();
    expect(screen.getByText('来源未提供记录次数')).toBeInTheDocument();
    expect(screen.queryByText('0 分钟')).not.toBeInTheDocument();
  });

  it('discards a late preview after switching games', async () => {
    let resolveOld: (value: ReinaEnvelope<ReinaStats>) => void = () => undefined;
    const pending = new Promise<ReinaEnvelope<ReinaStats>>((resolve) => { resolveOld = resolve; });
    installBridge({ reinaQuery: vi.fn().mockImplementation(async (_tool: string, input: { gameId: number }) => (
      input.gameId === 42 ? pending : envelope(makeStats({ sourceTotalMinutes: 60 }))
    )) });
    const view = render(<ReinaHistoryPreview key="42" sourceId={source.id} gameId={42} />);
    expect(screen.getByText('正在预览历史时长…')).toBeInTheDocument();
    view.rerender(<ReinaHistoryPreview key="43" sourceId={source.id} gameId={43} />);
    expect(await screen.findByText('1 小时')).toBeInTheDocument();
    await act(async () => { resolveOld(envelope(makeStats())); });
    expect(screen.queryByText('100 小时')).not.toBeInTheDocument();
    expect(screen.getByText('1 小时')).toBeInTheDocument();
  });
});

describe('ReinaGamePanel', () => {
  it('browses differently named source games, previews lifetime totals and reads history only after confirmation', async () => {
    const candidate: ReinaGame = {
      id: 42, name: '来源中的日文标题', externalIds: [], tags: [], unsupportedTagProviders: [],
    };
    const links: ReinaLink[] = [];
    const bind = vi.fn().mockImplementation(async (link: ReinaLink) => { links.push(link); });
    const api = makeGameApi({
      reinaLinks: vi.fn().mockImplementation(async () => [...links]),
      reinaBind: bind,
      reinaQuery: vi.fn().mockImplementation(async (tool: string, input: { query?: string }) => {
        if (tool === 'reina_list_games') return envelope(input.query ? [] : [candidate]);
        if (tool === 'reina_get_stats') return envelope(makeStats());
        return envelope([makeSession(1)]);
      }),
    });
    installBridge(api);
    render(<ReinaGamePanel gameId="game-1" gameName="本地中文文件夹名" />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'ReinaManager 来源' })).toHaveValue(source.id));
    expect(await screen.findByText(/数据库已连接，此作品尚未关联/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '搜索候选' }));
    expect(await screen.findByText(/没有找到匹配的游戏/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '浏览全部来源作品' }));
    fireEvent.click(await screen.findByRole('radio', { name: /来源中的日文标题/ }));
    const preview = await screen.findByRole('region', { name: '历史时长预览' });
    expect(await within(preview).findByText('100 小时')).toBeInTheDocument();
    expect(within(preview).getByText(/来源记录 80 次/)).toBeInTheDocument();
    expect(bind).not.toHaveBeenCalled();
    expect(api.reinaQuery.mock.calls.some(([tool]) => tool === 'reina_list_sessions')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '关联此作品' }));
    expect(await screen.findByText(/已关联《来源中的日文标题》/)).toBeInTheDocument();
    const stats = await screen.findByRole('group', { name: '游玩统计（两种口径）' });
    expect(within(stats).getByText('100 小时')).toBeInTheDocument();
    await waitFor(() => expect(api.reinaQuery).toHaveBeenCalledWith('reina_list_sessions', expect.objectContaining({ gameId: 42 })));
  });

  it('keeps browsing pagination and retry independent of edited search fields', async () => {
    const candidate: ReinaGame = { id: 42, name: '来源作品', externalIds: [], tags: [], unsupportedTagProviders: [] };
    let fail = true;
    const query = vi.fn().mockImplementation(async (_tool: string, input: { cursor?: string }) => {
      if (fail) { fail = false; throw new Error('来源忙，请重试'); }
      return envelope(input.cursor ? [{ ...candidate, id: 43, name: '下一页作品' }] : [candidate], { nextCursor: input.cursor ? null : 'next-page' });
    });
    installBridge(makeGameApi({ reinaQuery: query }));
    render(<ReinaGamePanel gameId="game-1" gameName="本地文件夹" />);
    fireEvent.click(await screen.findByRole('button', { name: '浏览全部来源作品' }));
    expect(await screen.findByText('来源忙，请重试')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: '搜索方式' }), { target: { value: 'vndb' } });
    // Empty VNDB input must not prevent retrying a previous browse request.
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByRole('radio', { name: /来源作品/ });
    fireEvent.click(screen.getByRole('button', { name: '加载更多候选' }));
    await screen.findByRole('radio', { name: /下一页作品/ });
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(query.mock.calls.map(([, input]) => input)).toEqual([
      { sourceId: source.id, limit: 20 },
      { sourceId: source.id, limit: 20 },
      { sourceId: source.id, limit: 20, cursor: 'next-page' },
    ]);
  });

  it('discards a late links response after the game changes', async () => {
    let resolveFirst: (links: ReinaLink[]) => void = () => undefined;
    const first = new Promise<ReinaLink[]>((resolve) => {
      resolveFirst = resolve;
    });
    const firstLink: ReinaLink = {
      localGameId: 'game-1',
      sourceId: 'reina-main',
      externalGameId: 42,
      externalName: 'Game One Link',
    };
    const api = makeGameApi({
      reinaLinks: vi.fn().mockImplementation((localGameId: string) => (
        localGameId === 'game-1' ? first : Promise.resolve([linkedGame])
      )),
    });
    installBridge(api);

    const { rerender } = render(<ReinaGamePanel gameId="game-1" gameName="Game One" />);
    await waitFor(() => expect(api.reinaLinks).toHaveBeenCalledWith('game-1'));

    rerender(<ReinaGamePanel gameId="game-2" gameName="Game Two" />);
    expect(await screen.findByText(/已关联《Summer Pockets Link》/)).toBeInTheDocument();

    await act(async () => {
      resolveFirst([firstLink]);
      await Promise.resolve();
    });

    expect(screen.queryByText(/Game One Link/)).toBeNull();
    expect(screen.getByText(/已关联《Summer Pockets Link》/)).toBeInTheDocument();
  });

  it('recommends candidates by matched metadata id without auto-binding', async () => {
    const otherCandidate: ReinaGame = {
      id: 3,
      name: 'Other Candidate',
      externalIds: [{ provider: 'vndb', id: 'v111' }],
      tags: [],
      unsupportedTagProviders: [],
    };
    const matchedCandidate: ReinaGame = {
      id: 9,
      name: 'Matched Candidate',
      externalIds: [{ provider: 'vndb', id: 'v900' }],
      tags: [],
      unsupportedTagProviders: [],
    };
    const api = makeGameApi({
      getGameMetadata: vi.fn().mockResolvedValue({
        gameId: 'game-1',
        coverSource: null,
        sources: [{
          source: 'vndb',
          status: 'matched',
          queryName: 'Game One',
          externalId: 'v900',
          title: null,
          titleCn: null,
          developer: null,
          summary: null,
          score: null,
          rank: null,
          fetchedAt: null,
          errorMessage: null,
        }],
      }),
      reinaQuery: vi.fn().mockImplementation(async (tool: string) => (
        tool === 'reina_list_games'
          ? envelope([otherCandidate, matchedCandidate])
          : envelope([makeSession(1)])
      )),
    });
    installBridge(api);

    render(<ReinaGamePanel gameId="game-1" gameName="Game One" />);
    // The source is auto-picked after sources+links settle; search requires it.
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'ReinaManager 来源' })).toHaveValue('reina-main');
    });
    const searchButton = await screen.findByRole('button', { name: '搜索候选' });
    await waitFor(() => expect(searchButton).toBeEnabled());
    fireEvent.click(searchButton);

    const radios = await screen.findAllByRole('radio');
    expect(radios).toHaveLength(2);
    await waitFor(() => {
      const ordered = screen.getAllByRole('radio');
      expect(ordered[0]).toHaveTextContent('Matched Candidate');
      expect(within(ordered[0] as HTMLElement).getByText('推荐 · 资料 ID 匹配')).toBeInTheDocument();
    });
    expect(screen.getByText(/不会自动绑定/)).toBeInTheDocument();
    expect(screen.getByText('尚未选择候选作品。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关联此作品' })).toBeDisabled();
  });
});
