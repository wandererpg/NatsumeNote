/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
});
