import { ArrowUpRight, Disc3, LibraryBig, MoreHorizontal, Plus, SearchX } from 'lucide-react';
import type { CSSProperties } from 'react';

import { toCoverUrl } from '../../../../shared/cover-url';
import type { Game } from '../../../../shared/types';

export interface GameShelfProps {
  games: Game[];
  searchText: string;
  onSelectGame: (game: Game) => void;
  onEditGame: (game: Game) => void;
  onImport: () => void;
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase() || 'GN';
}

export function GameShelf({ games, searchText, onSelectGame, onEditGame, onImport }: GameShelfProps) {
  const query = searchText.trim().toLocaleLowerCase();
  const visibleGames = query
    ? games.filter((game) => game.name.toLocaleLowerCase().includes(query))
    : games;

  return (
    <section className="game-shelf" aria-labelledby="game-shelf-title">
      <header className="game-shelf__header">
        <div>
          <p className="eyebrow">NATSUME ARCHIVE</p>
          <h1 id="game-shelf-title">游戏仓库</h1>
          <p>从一部作品开始，回到它的音乐与记忆。</p>
        </div>
        <div className="game-shelf__summary" aria-label={`共 ${games.length} 部作品`}>
          <LibraryBig size={18} aria-hidden="true" />
          <strong>{games.length}</strong>
          <span>部作品</span>
        </div>
        <button className="button button--primary game-shelf__import" type="button" onClick={onImport}>
          <Plus size={16} aria-hidden="true" />导入游戏
        </button>
      </header>

      {visibleGames.length === 0 ? (
        <div className="game-shelf__empty" data-testid="game-list">
          <SearchX size={28} aria-hidden="true" />
          <strong>没有找到对应作品</strong>
          <span>尝试更换搜索词，或导入一部新的 Galgame。</span>
          <button className="button button--ghost" type="button" onClick={onImport}>导入游戏</button>
        </div>
      ) : (
        <div className="game-shelf__grid" data-testid="game-list">
          {visibleGames.map((game, index) => (
            <article className="game-poster" key={game.id} style={{ '--poster-index': index } as CSSProperties}>
              <button
                className="game-poster__open"
                type="button"
                data-testid={`game-item-${game.id}`}
                aria-label={`打开 ${game.name}`}
                onClick={() => onSelectGame(game)}
              >
                <span className="game-poster__art" aria-hidden="true">
                  {game.coverPath ? (
                    <img src={toCoverUrl(game.coverPath)} alt="" />
                  ) : (
                    <span className="game-poster__fallback"><span>{initials(game.name)}</span></span>
                  )}
                  <span className="game-poster__scrim" />
                  <span className="game-poster__enter"><ArrowUpRight size={16} />进入作品</span>
                </span>
                <span className="game-poster__caption">
                  <strong title={game.name}>{game.name}</strong>
                  <span><Disc3 size={12} aria-hidden="true" />{game.trackCount} 首曲目</span>
                </span>
              </button>
              <button
                className="game-poster__edit"
                type="button"
                data-testid={`edit-game-${game.id}`}
                aria-label={`编辑 ${game.name}`}
                title="编辑作品"
                onClick={() => onEditGame(game)}
              >
                <MoreHorizontal size={17} aria-hidden="true" />
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
