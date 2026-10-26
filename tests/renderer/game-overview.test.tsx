/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GameOverview } from '../../src/renderer/src/components/library/GameOverview';
import type { Game, GameMetadataSummary } from '../../src/shared/types';

const game: Game = {
  id: 'g1', name: 'ATRI', coverPath: null, coverSource: null, folderPath: 'C:/Music/ATRI', trackCount: 12,
  createdAt: '', updatedAt: '',
};

const metadata: GameMetadataSummary = {
  gameId: 'g1',
  coverSource: null,
  sources: [{
    source: 'vndb', status: 'matched', queryName: 'ATRI', externalId: 'v17', title: 'ATRI', titleCn: null,
    developer: 'Frontwing', summary: 'A story about the sea and an unforgettable summer.', score: 8.5, rank: null,
    fetchedAt: '2026-09-14T00:00:00.000Z', errorMessage: null,
  }],
};

describe('GameOverview summary translation', () => {
  afterEach(() => cleanup());

  it('keeps the editor available without inserting network failure instructions into the archive', () => {
    const onEdit = vi.fn();
    render(<GameOverview game={game} metadata={{ ...metadata, sources: [{ ...metadata.sources[0],
      status: 'failed', summary: null, errorMessage: 'fetch failed' }] }} error="Bangumi 资料暂时加载失败" onEdit={onEdit} />);
    expect(screen.queryByRole('status', { name: '作品资料加载提示' })).not.toBeInTheDocument();
    expect(screen.queryByText(/资料暂时加载失败|刷新重试|已导入的作品和游玩记录仍可使用/)).not.toBeInTheDocument();
    expect(screen.getByText('暂未收录作品简介。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '编辑作品资料' }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('keeps cached content visible during a refresh', () => {
    render(<GameOverview game={game} metadata={metadata} loading onEdit={vi.fn()} />);
    expect(screen.getByText(metadata.sources[0].summary!)).toBeInTheDocument();
  });

  it('translates on demand and lets the user switch between Chinese, original, and bilingual text', async () => {
    const onTranslateSummary = vi.fn().mockResolvedValue('一个关于大海与难忘夏日的故事。');
    render(
      <GameOverview
        game={game}
        metadata={metadata}
        onEdit={vi.fn()}
        onTranslateSummary={onTranslateSummary}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '翻译为中文' }));
    await waitFor(() => expect(onTranslateSummary).toHaveBeenCalledWith('vndb'));
    expect(await screen.findByText('一个关于大海与难忘夏日的故事。')).toBeInTheDocument();
    expect(screen.getByText('A story about the sea and an unforgettable summer.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '仅显示原文' }));
    expect(screen.queryByText('一个关于大海与难忘夏日的故事。')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '中文与原文双语对照' }));
    expect(screen.getByText('一个关于大海与难忘夏日的故事。')).toBeInTheDocument();
    expect(screen.getByText('A story about the sea and an unforgettable summer.')).toBeInTheDocument();
  });

  it('does not offer machine translation when the source summary is already Chinese', () => {
    const chineseMetadata: GameMetadataSummary = {
      ...metadata,
      sources: [{ ...metadata.sources[0], summary: '这是一段已经是中文的作品简介。' }],
    };
    render(
      <GameOverview
        game={game}
        metadata={chineseMetadata}
        onEdit={vi.fn()}
        onTranslateSummary={vi.fn()}
      />,
    );

    expect(screen.getByText('这是一段已经是中文的作品简介。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '翻译为中文' })).not.toBeInTheDocument();
  });

  it('fills the archive with main character cards and a production staff panel', () => {
    const richMetadata: GameMetadataSummary = {
      ...metadata,
      sources: [{
        ...metadata.sources[0],
        characters: [{
          externalId: 'c1', name: 'Atri', originalName: 'アトリ', role: 'main', description: 'A mechanical girl.',
          imageUrl: 'https://img.example/atri.jpg', voiceActors: ['Hikaru Akao'], sourceUrl: 'https://vndb.org/c1',
        }],
        staff: [{
          externalId: 's1', name: 'Asuta Konno', originalName: '紺野アスタ', role: 'scenario', imageUrl: null, sourceUrl: 'https://vndb.org/s1',
        }],
      }],
    };
    render(<GameOverview game={game} metadata={richMetadata} onEdit={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '主要人物' })).toBeInTheDocument();
    expect(screen.getByText('Atri')).toBeInTheDocument();
    expect(screen.getByText('声优 · Hikaru Akao')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '主创团队' })).toBeInTheDocument();
    expect(screen.getByText('Asuta Konno')).toBeInTheDocument();
    expect(screen.getByText('剧本')).toBeInTheDocument();
  });

  it('puts source-aware tags in the right information rail and keeps their navigation action', () => {
    const onSelectTag = vi.fn();
    render(<GameOverview game={game} metadata={{ ...metadata, sources: [{ ...metadata.sources[0], tags: ['夏日', '机器人'] }] }} onEdit={vi.fn()} onSelectTag={onSelectTag} />);
    const rail = screen.getByRole('complementary', { name: '作品信息' });
    const tags = within(rail).getByRole('group', { name: '作品标签' });
    fireEvent.click(within(tags).getByRole('button', { name: '夏日 · VNDB' }));
    expect(onSelectTag).toHaveBeenCalledWith('vndb:夏日');
    expect(within(rail).queryByText(/多选为 AND/)).not.toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: '清空筛选' })).not.toBeInTheDocument();
    expect(screen.queryByText('已保存的游玩记录')).not.toBeInTheDocument();
  });

  it('keeps all staff entries reachable in the focusable scrolling list', () => {
    const staff = Array.from({ length: 24 }, (_, index) => ({
      externalId: `s${index}`, name: `主创 ${index + 1}`, originalName: null, role: 'scenario',
      imageUrl: null, sourceUrl: `https://vndb.org/s${index}`,
    }));
    render(<GameOverview game={game} metadata={{ ...metadata, sources: [{ ...metadata.sources[0], staff }] }} onEdit={vi.fn()} />);
    const list = screen.getByRole('list', { name: '主创团队名单' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(24);
    expect(within(list).getByRole('link', { name: /主创 24/ })).toBeInTheDocument();
    expect(list).toHaveAttribute('tabindex', '0');
    list.focus();
    expect(list).toHaveFocus();
  });
});
