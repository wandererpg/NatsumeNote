import { Check, ExternalLink } from 'lucide-react';

import type { GameMetadataSourceSummary } from '../../../../shared/types';

export interface MetadataCandidatePickerProps {
  source: GameMetadataSourceSummary;
  selectedId: string | null;
  busy: boolean;
  onSelectionChange: (externalId: string) => void;
  onConfirm: () => void;
}

function sourceLabel(source: GameMetadataSourceSummary['source']): string {
  return source === 'vndb' ? 'VNDB' : 'Bangumi';
}

export function MetadataCandidatePicker({ source, selectedId, busy, onSelectionChange, onConfirm }: MetadataCandidatePickerProps) {
  const candidates = source.candidates ?? [];
  if (candidates.length === 0) return null;
  const label = sourceLabel(source.source);
  const selectionChanged = Boolean(selectedId && selectedId !== source.externalId);
  const alreadySelected = Boolean(selectedId && selectedId === source.externalId);

  return (
    <fieldset className="metadata-candidates">
      <legend>{source.status === 'ambiguous' ? `请选择正确的 ${label} 条目` : `核对或更换 ${label} 条目`}</legend>
      <p>搜索名：{source.queryName} · 共 {candidates.length} 个候选</p>
      <div className="metadata-candidates__list">
        {candidates.map((candidate) => {
          const checked = candidate.externalId === selectedId;
          return (
            <label className={`metadata-candidate${checked ? ' is-selected' : ''}`} key={candidate.externalId}>
              <input
                type="radio"
                name={`metadata-${source.source}`}
                value={candidate.externalId}
                checked={checked}
                onChange={() => onSelectionChange(candidate.externalId)}
              />
              <span className="metadata-candidate__marker">{checked && <Check size={12} aria-hidden="true" />}</span>
              <span className="metadata-candidate__copy">
                <strong>{candidate.titleCn || candidate.title}</strong>
                {candidate.titleCn && candidate.titleCn !== candidate.title && <small>{candidate.title}</small>}
                <span>{[
                  candidate.developer,
                  candidate.releaseDate,
                  candidate.score !== null ? `评分 ${candidate.score.toFixed(1)}` : null,
                ].filter(Boolean).join(' · ') || `条目 ${candidate.externalId}`}</span>
              </span>
              <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" aria-label={`查看 ${candidate.title} 的 ${label} 条目`} onClick={(event) => event.stopPropagation()}><ExternalLink size={14} aria-hidden="true" /></a>
            </label>
          );
        })}
      </div>
      <button className="button button--primary metadata-candidates__confirm" type="button" disabled={!selectedId || busy || !selectionChanged} onClick={onConfirm}>
        {busy ? '确认中…' : alreadySelected ? `已使用此 ${label} 条目` : `确认 ${label} 匹配`}
      </button>
    </fieldset>
  );
}
