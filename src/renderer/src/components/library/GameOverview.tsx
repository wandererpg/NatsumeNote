import { CalendarDays, ExternalLink, Gamepad2, Languages, LibraryBig, Sparkles, Star, Tags } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReinaTag } from '../../../../shared/reina';
import { TagChips } from '../../features/reina/TagChips';

import { toCoverUrl } from '../../../../shared/cover-url';
import type { Game, GameMetadataSourceSummary, GameMetadataSummary, MetadataSource } from '../../../../shared/types';
import { SummaryReader } from './SummaryReader';
import { GameArchiveDetails } from './GameArchiveDetails';

export interface GameOverviewProps {
  game: Game;
  metadata: GameMetadataSummary | null;
  loading?: boolean;
  error?: string | null;
  onEdit: () => void;
  onTranslateSummary?: (source: MetadataSource) => Promise<string>;
  onSelectTag?: (name: string) => void;
}

function bestSource(metadata: GameMetadataSummary | null): GameMetadataSourceSummary | null {
  if (!metadata) return null;
  return metadata.sources.find((source) => source.status === 'matched' && source.summary)
    ?? metadata.sources.find((source) => source.status === 'matched')
    ?? null;
}

function bestCreditsSource(metadata: GameMetadataSummary | null): GameMetadataSourceSummary | null {
  if (!metadata) return null;
  return metadata.sources
    .filter((source) => source.status === 'matched' && ((source.characters?.length ?? 0) > 0 || (source.staff?.length ?? 0) > 0))
    .sort((left, right) => ((right.characters?.length ?? 0) * 2 + (right.staff?.length ?? 0)) - ((left.characters?.length ?? 0) * 2 + (left.staff?.length ?? 0)))[0]
    ?? null;
}

export function GameOverview({ game, metadata, loading = false, onEdit, onTranslateSummary, onSelectTag }: GameOverviewProps) {
  const source = bestSource(metadata);
  const creditsSource = bestCreditsSource(metadata);
  const [indexedTags, setIndexedTags] = useState<ReinaTag[]>([]);
  useEffect(() => {
    let active = true; let generation = 0;
    const reload = () => {
      const request = ++generation;
      void window.galMusic?.getGameTags?.(game.id).then(tags => { if (active && request === generation) setIndexedTags(tags); }).catch(() => undefined);
    };
    setIndexedTags([]); reload();
    window.addEventListener('reina-tags-changed', reload);
    return () => { active = false; window.removeEventListener('reina-tags-changed', reload); };
  }, [game.id, metadata]);
  const tags: ReinaTag[] = [...(metadata?.sources.filter(item => item.status === 'matched').flatMap(item => (item.tags ?? []).map(name => ({ name, provider: item.source }))) ?? []), ...indexedTags];

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
        {loading && !source?.summary ? (
          <p className="game-overview__summary">正在读取作品资料…</p>
        ) : source?.summary ? (
          <SummaryReader
            original={source.summary}
            translated={source.summaryZhCn ?? null}
            onTranslate={onTranslateSummary ? () => onTranslateSummary(source.source) : undefined}
          />
        ) : <p className="game-overview__summary">暂未收录作品简介。</p>}
        <button className="button button--ghost" type="button" onClick={onEdit}>编辑作品资料</button>
      </div>

      <aside className="game-overview__facts" aria-label="作品信息">
        <div className="game-overview__fact"><LibraryBig size={17} aria-hidden="true" /><span>音乐收藏<strong>{game.trackCount} 首曲目</strong></span></div>
        {source?.developer && <div className="game-overview__fact"><Gamepad2 size={17} aria-hidden="true" /><span>开发商<strong>{source.developer}</strong></span></div>}
        {source?.releaseDate && <div className="game-overview__fact"><CalendarDays size={17} aria-hidden="true" /><span>发行日期<strong>{source.releaseDate}</strong></span></div>}
        {source?.languages && source.languages.length > 0 && <div className="game-overview__fact"><Languages size={17} aria-hidden="true" /><span>语言<strong>{source.languages.join('、')}</strong></span></div>}
        {source?.score !== null && source?.score !== undefined && <div className="game-overview__fact"><Star size={17} aria-hidden="true" /><span>资料评分<strong>{source.score.toFixed(1)}{source.rank !== null ? ` · #${source.rank}` : ''}</strong></span></div>}
        {tags.length > 0 && <section className="game-overview__tags" aria-labelledby="game-tags-heading">
          <h3 id="game-tags-heading"><Tags size={14} aria-hidden="true" />作品标签</h3>
          <TagChips tags={tags} onToggle={onSelectTag} variant="browse" />
        </section>}
        {source?.sourceUrl && <a href={source.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" />在 {source.source === 'vndb' ? 'VNDB' : 'Bangumi'} 查看</a>}
      </aside>
      {creditsSource && <GameArchiveDetails source={creditsSource} />}
    </section>
  );
}
