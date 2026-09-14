import { CalendarDays, ExternalLink, Gamepad2, Languages, LibraryBig, Sparkles, Star } from 'lucide-react';

import { toCoverUrl } from '../../../../shared/cover-url';
import type { Game, GameMetadataSourceSummary, GameMetadataSummary, MetadataSource } from '../../../../shared/types';
import { SummaryReader } from './SummaryReader';

export interface GameOverviewProps {
  game: Game;
  metadata: GameMetadataSummary | null;
  loading?: boolean;
  onEdit: () => void;
  onTranslateSummary?: (source: MetadataSource) => Promise<string>;
}

function bestSource(metadata: GameMetadataSummary | null): GameMetadataSourceSummary | null {
  if (!metadata) return null;
  return metadata.sources.find((source) => source.status === 'matched' && source.summary)
    ?? metadata.sources.find((source) => source.status === 'matched')
    ?? null;
}

export function GameOverview({ game, metadata, loading = false, onEdit, onTranslateSummary }: GameOverviewProps) {
  const source = bestSource(metadata);

  return (
    <section className="game-overview" aria-labelledby="game-overview-heading">
      <div className="game-overview__cover" aria-hidden="true">
        {game.coverPath ? <img src={toCoverUrl(game.coverPath)} alt="" /> : <span>{game.name.slice(0, 2).toUpperCase()}</span>}
      </div>
      <div className="game-overview__main">
        <p className="eyebrow"><Sparkles size={13} aria-hidden="true" />作品档案</p>
        <h2 id="game-overview-heading">{source?.titleCn || source?.title || game.name}</h2>
        {source?.titleCn && source.title && source.titleCn !== source.title && (
          <p className="game-overview__original-title">{source.title}</p>
        )}
        {loading ? (
          <p className="game-overview__summary">正在读取作品资料…</p>
        ) : source?.summary ? (
          <SummaryReader
            original={source.summary}
            translated={source.summaryZhCn ?? null}
            onTranslate={onTranslateSummary ? () => onTranslateSummary(source.source) : undefined}
          />
        ) : (
          <p className="game-overview__summary">还没有可展示的作品简介。可以编辑作品或刷新网络资料，为这部作品补全档案。</p>
        )}
        {source?.tags && source.tags.length > 0 && (
          <div className="game-overview__tags" aria-label="作品标签">
            {source.tags.slice(0, 10).map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        )}
        <button className="button button--ghost" type="button" onClick={onEdit}>编辑作品资料</button>
      </div>

      <aside className="game-overview__facts" aria-label="作品信息">
        <div><LibraryBig size={17} aria-hidden="true" /><span>音乐收藏<strong>{game.trackCount} 首曲目</strong></span></div>
        {source?.developer && <div><Gamepad2 size={17} aria-hidden="true" /><span>开发商<strong>{source.developer}</strong></span></div>}
        {source?.releaseDate && <div><CalendarDays size={17} aria-hidden="true" /><span>发行日期<strong>{source.releaseDate}</strong></span></div>}
        {source?.languages && source.languages.length > 0 && <div><Languages size={17} aria-hidden="true" /><span>语言<strong>{source.languages.join('、')}</strong></span></div>}
        {source?.score !== null && source?.score !== undefined && <div><Star size={17} aria-hidden="true" /><span>资料评分<strong>{source.score.toFixed(1)}{source.rank !== null ? ` · #${source.rank}` : ''}</strong></span></div>}
        {source?.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" />在 {source.source === 'vndb' ? 'VNDB' : 'Bangumi'} 查看</a>}
      </aside>
    </section>
  );
}
