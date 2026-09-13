/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GameEditor } from '../../src/renderer/src/components/library/GameEditor';
import type { Game, GameMetadataSummary } from '../../src/shared/types';

const game: Game = {
  id: 'game-delete', name: 'Delete Me', coverPath: null, coverSource: null, folderPath: 'C:/Music/Delete Me', trackCount: 3,
  createdAt: '', updatedAt: '',
};

describe('GameEditor deletion', () => {
  afterEach(() => cleanup());

  it('requires an explicit confirmation before deleting the music folder', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <GameEditor
        game={game}
        onClose={vi.fn()}
        onSelectImage={vi.fn().mockResolvedValue(null)}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '删除音乐文件夹' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认永久删除' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  });

  it('shows sanitized VNDB/Bangumi summaries and supports refresh', async () => {
    const metadata: GameMetadataSummary = {
      gameId: game.id,
      coverSource: 'vndb',
      sources: [
        {
          source: 'vndb',
          status: 'matched',
          queryName: 'Delete Me',
          externalId: 'v17',
          title: 'ATRI',
          titleCn: 'ATRI -My Dear Moments-',
          developer: 'Frontwing',
          summary: 'A locally cached summary.',
          score: 8.5,
          rank: 17,
          releaseDate: '2020-06-19',
          languages: ['ja', 'zh-Hans'],
          platforms: ['win'],
          tags: ['Science fiction', 'Android'],
          sourceUrl: 'https://vndb.org/v17',
          fetchedAt: '2026-08-24T00:00:00.000Z',
          errorMessage: null,
        },
        {
          source: 'bangumi',
          status: 'no_match',
          queryName: 'Delete Me',
          externalId: null,
          title: null,
          titleCn: null,
          developer: null,
          summary: null,
          score: null,
          rank: null,
          fetchedAt: '2026-08-24T00:00:00.000Z',
          errorMessage: null,
        },
      ],
    };
    const onRefreshMetadata = vi.fn().mockResolvedValue(metadata);
    render(
      <GameEditor
        game={game}
        metadata={metadata}
        onRefreshMetadata={onRefreshMetadata}
        onClose={vi.fn()}
        onSelectImage={vi.fn().mockResolvedValue(null)}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText('网络资料')).toBeInTheDocument();
    expect(screen.getByText('封面：已添加（VNDB）')).toBeInTheDocument();
    expect(screen.getByText('开发商：Frontwing')).toBeInTheDocument();
    expect(screen.getByText('发行日期：2020-06-19')).toBeInTheDocument();
    expect(screen.getByText('平台：win')).toBeInTheDocument();
    expect(screen.getByText('Science fiction')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '查看 VNDB 条目' })).toHaveAttribute('href', 'https://vndb.org/v17');
    expect(screen.getByText('已匹配')).toBeInTheDocument();
    expect(screen.getByText('无结果')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新网络资料' }));
    await waitFor(() => expect(onRefreshMetadata).toHaveBeenCalledTimes(1));
  });

  it('lets the user choose and confirm an ambiguous source candidate', async () => {
    const candidates = [
      {
        externalId: 'v17', title: 'ATRI -My Dear Moments-', titleCn: 'ATRI', developer: 'Frontwing',
        summary: '候选一', score: 8.5, rank: null, releaseDate: '2020-06-19', languages: ['ja'], platforms: ['win'],
        tags: ['科幻'], sourceUrl: 'https://vndb.org/v17',
      },
      {
        externalId: 'v18', title: 'ATRI Another Story', titleCn: null, developer: 'Studio B',
        summary: '候选二', score: 7.1, rank: null, releaseDate: '2021-01-01', languages: ['ja'], platforms: ['win'],
        tags: [], sourceUrl: 'https://vndb.org/v18',
      },
    ];
    const ambiguous: GameMetadataSummary = {
      gameId: game.id,
      coverSource: null,
      sources: [
        {
          source: 'vndb', status: 'ambiguous', queryName: 'ATRI', externalId: null, title: null, titleCn: null,
          developer: null, summary: null, score: null, rank: null, candidates, fetchedAt: '2026-09-14T00:00:00.000Z', errorMessage: null,
        },
        {
          source: 'bangumi', status: 'no_match', queryName: 'ATRI', externalId: null, title: null, titleCn: null,
          developer: null, summary: null, score: null, rank: null, candidates: [], fetchedAt: '2026-09-14T00:00:00.000Z', errorMessage: null,
        },
      ],
    };
    const matched: GameMetadataSummary = {
      ...ambiguous,
      coverSource: 'vndb',
      sources: [{ ...ambiguous.sources[0], ...candidates[0], status: 'matched', candidates }, ambiguous.sources[1]],
    };
    const onSelectMetadataCandidate = vi.fn().mockResolvedValue(matched);
    render(
      <GameEditor
        game={game}
        metadata={ambiguous}
        onRefreshMetadata={vi.fn().mockResolvedValue(ambiguous)}
        onSelectMetadataCandidate={onSelectMetadataCandidate}
        onClose={vi.fn()}
        onSelectImage={vi.fn().mockResolvedValue(null)}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText('请选择正确的 VNDB 条目')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: '确认 VNDB 匹配' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /ATRI -My Dear Moments-/ }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => expect(onSelectMetadataCandidate).toHaveBeenCalledWith(game.id, 'vndb', 'v17'));
    expect(await screen.findByText('已匹配')).toBeInTheDocument();
  });
});
