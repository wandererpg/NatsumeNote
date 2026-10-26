import { Music2, Play, Sparkles } from 'lucide-react';
import { toJournalMediaUrl } from '../../../../shared/journal-media-url';
import type { JournalAsset, JournalBlock, Track } from '../../../../shared/types';
import { formatPlayDate, formatPlayMinutes, formatPlaySessionRange, formatSnapshotFetchedAt } from './journal-play-session';

function formatTrackTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '从头播放';
  const total = Math.max(0, Math.floor(seconds));
  return `从 ${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')} 开始`;
}

export function JournalBlockBody({
  block,
  asset,
  track,
  onTextChange,
  onQuoteChange,
  onCaptionChange,
  onTrackNoteChange,
  onPlayTrack,
  onSeekTo,
}: {
  block: JournalBlock;
  asset?: JournalAsset;
  track?: Track;
  onTextChange(blockId: string, value: string): void;
  onQuoteChange(blockId: string, field: 'quote' | 'attribution', value: string): void;
  onCaptionChange(blockId: string, value: string): void;
  onTrackNoteChange(blockId: string, value: string): void;
  onPlayTrack(track: Track): void;
  onSeekTo(seconds: number): void;
}) {
  if (block.type === 'text') {
    return (
      <textarea
        readOnly={block.locked}
        className="journal-block__text-input"
        value={block.text}
        onChange={(event) => onTextChange(block.id, event.target.value)}
        placeholder="写下此刻…"
        style={{ color: block.color, fontSize: `${block.fontSize}px`, textAlign: block.align, background: block.backgroundColor }}
        aria-label="手账文字"
      />
    );
  }

  if (block.type === 'quote') {
    return (
      <div className="journal-block__quote-content" style={{ borderLeftColor: block.accentColor }}>
        <textarea
          readOnly={block.locked}
          className="journal-block__quote-input"
          value={block.quote}
          onChange={(event) => onQuoteChange(block.id, 'quote', event.target.value)}
          aria-label="引用内容"
        />
        <input
          readOnly={block.locked}
          className="journal-block__attribution-input"
          value={block.attribution}
          onChange={(event) => onQuoteChange(block.id, 'attribution', event.target.value)}
          placeholder="署名（可选）"
          aria-label="引用署名"
        />
      </div>
    );
  }

  if (block.type === 'image' || block.type === 'video') {
    return (
      <div className="journal-block__media-content">
        {asset && block.type === 'image' ? (
          <img src={toJournalMediaUrl(asset.filePath)} alt={block.caption || asset.fileName} />
        ) : asset && block.type === 'video' ? (
          <video src={toJournalMediaUrl(asset.filePath)} controls preload="metadata" />
        ) : (
          <div className="journal-block__media-missing"><Sparkles size={25} /><span>素材暂不可用</span></div>
        )}
        <input
          readOnly={block.locked}
          className="journal-block__caption-input"
          value={block.caption}
          onChange={(event) => onCaptionChange(block.id, event.target.value)}
          placeholder={asset?.fileName ?? '添加说明…'}
          aria-label="素材说明"
        />
      </div>
    );
  }

  if (block.type === 'track') {
    return (
      <div className="journal-block__track-content">
        <div className="journal-block__track-disc"><Music2 size={24} /></div>
        <div className="journal-block__track-copy">
          <span>音乐片段</span>
          <strong>{track?.displayName ?? '未找到曲目'}</strong>
          <small>{formatTrackTime(block.startTime)}</small>
        </div>
        {track && (
          <button
            className="journal-block__track-play"
            type="button"
            aria-label="播放这段音乐"
            onClick={(event) => {
              event.stopPropagation();
              onPlayTrack(track);
              if (block.startTime !== null) window.setTimeout(() => onSeekTo(block.startTime ?? 0), 100);
            }}
          ><Play size={15} fill="currentColor" /></button>
        )}
        <input
          readOnly={block.locked}
          className="journal-block__track-note"
          value={block.note}
          onChange={(event) => onTrackNoteChange(block.id, event.target.value)}
          placeholder="这首曲子让我想起…"
          aria-label="音乐笔记"
        />
      </div>
    );
  }

  if (block.type === 'play-session') {
    const snapshot = block.snapshot;
    const shownSessions = snapshot.sessions.slice(0, 3);
    return (
      <div className="journal-block__play-content">
        <div className="journal-block__play-head"><span>游玩记录</span><small>{snapshot.stats.sessionCount} 次 · 离线快照</small></div>
        <strong className="journal-block__play-name">{snapshot.externalGameName}</strong>
        <div className="journal-block__play-total">{formatPlayMinutes(snapshot.stats.sessionTotalMinutes)}</div>
        {shownSessions.length > 0 && (
          <ul className="journal-block__play-list">
            {shownSessions.map((session) => (
              <li key={session.id}><span>{formatPlayDate(session)} · {formatPlaySessionRange(session)}</span><span>{session.recordedMinutes} 分钟</span></li>
            ))}
          </ul>
        )}
        {snapshot.sessions.length > shownSessions.length && <small className="journal-block__play-more">另有 {snapshot.sessions.length - shownSessions.length} 次记录</small>}
        <small className="journal-block__play-meta">截至 {formatSnapshotFetchedAt(snapshot.fetchedAt)} · {snapshot.sourceApp} · {snapshot.sourceId}</small>
      </div>
    );
  }

  return null;
}
