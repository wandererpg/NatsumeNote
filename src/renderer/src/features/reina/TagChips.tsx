import { useEffect, useMemo, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
import { reinaTagKey, type ReinaTag } from '../../../../shared/reina';
import { providerLabel } from './reina-format';
import './reina.css';

export interface TagChipsProps {
  tags: ReinaTag[];
  /** Stable `provider:name` keys, not bare tag names. */
  selected?: string[];
  onToggle?: (key: string) => void;
  onClear?: () => void;
}

interface TagEntry {
  key: string;
  name: string;
  provider: string;
}

const COLLAPSED_COUNT = 12;

/** Render an invalid selection key for the notice without exposing the raw separator. */
function displayKey(key: string): string {
  const separator = key.indexOf(':');
  if (separator < 0) return key;
  const name = key.slice(separator + 1);
  const provider = key.slice(0, separator);
  if (!name) return key;
  return provider ? `${name}（${providerLabel(provider)}）` : name;
}

/**
 * AND-combined Reina tag filter. Every distinct (provider, name) pair is its own
 * chip: the same text from VNDB and Bangumi must never merge into one filter.
 * Selected values and onToggle arguments are stable `provider:name` keys.
 */
export function TagChips({ tags, selected, onToggle, onClear }: TagChipsProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissedInvalid, setDismissedInvalid] = useState<string[]>([]);
  const [pendingRemoval, setPendingRemoval] = useState<string[]>([]);
  const handledInvalidRef = useRef<Set<string>>(new Set());

  const entries = useMemo<TagEntry[]>(() => {
    const byKey = new Map<string, TagEntry>();
    for (const tag of tags) {
      if (typeof tag.name !== 'string' || !tag.name.trim()) continue;
      const provider = typeof tag.provider === 'string' ? tag.provider : '';
      const key = reinaTagKey(tag);
      if (!byKey.has(key)) byKey.set(key, { key, name: tag.name, provider });
    }
    return [...byKey.values()];
  }, [tags]);

  const selectedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const key of selected ?? []) {
      if (typeof key === 'string' && key.trim()) keys.add(key);
    }
    return [...keys];
  }, [selected]);

  const knownKeys = useMemo(() => new Set(entries.map((entry) => entry.key)), [entries]);
  const knownSignature = entries.map((entry) => entry.key).join('\u0000');
  const invalidKeys = selectedKeys.filter((key) => !knownKeys.has(key));
  const visibleInvalid = invalidKeys.filter((key) => !dismissedInvalid.includes(key));

  // Keep auto-removed keys visible in the notice until the user dismisses it.
  const pendingVisible = pendingRemoval.filter(
    (key) => !knownKeys.has(key) && !dismissedInvalid.includes(key),
  );

  useEffect(() => {
    setDismissedInvalid([]);
  }, [knownSignature]);

  useEffect(() => {
    for (const key of handledInvalidRef.current) {
      if (!invalidKeys.includes(key)) handledInvalidRef.current.delete(key);
    }
    const newlyInvalid = invalidKeys.filter((key) => !handledInvalidRef.current.has(key));
    if (newlyInvalid.length === 0) return;
    for (const key of newlyInvalid) handledInvalidRef.current.add(key);
    setPendingRemoval((previous) => [...new Set([...previous, ...newlyInvalid])]);
    if (onToggle) {
      for (const key of newlyInvalid) onToggle(key);
    }
  }, [invalidKeys, onToggle]);

  const shown = expanded ? entries : entries.slice(0, COLLAPSED_COUNT);
  const hiddenCount = entries.length - shown.length;
  const noticeKeys = [...new Set([...visibleInvalid, ...pendingVisible])];

  const dismissNotice = () => {
    setDismissedInvalid((previous) => [...new Set([...previous, ...noticeKeys])]);
  };

  return (
    <div className="reina-tags-block">
      <div className="reina-tags__summary">
        <span>
          已选 <strong>{selectedKeys.length}</strong> 个 · 多选为 AND（需同时满足）
        </span>
        <button
          className="reina-link-button"
          type="button"
          onClick={onClear}
          disabled={!onClear || selectedKeys.length === 0}
        >
          清空筛选
        </button>
      </div>

      {noticeKeys.length > 0 && (
        <div className="reina-tags__notice" role="status">
          <Info size={14} aria-hidden="true" />
          <div>
            <p>
              有 {noticeKeys.length} 个筛选条件已失效（来源标签中没有这些标签）
              {onToggle ? '，已从筛选中移除：' : '，请在筛选条件中清除：'}
            </p>
            <p className="reina-tags__notice-names">{noticeKeys.map(displayKey).join('、')}</p>
            <button className="reina-link-button" type="button" onClick={dismissNotice}>
              知道了
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="reina-empty">此作品没有 ReinaManager 标签。</p>
      ) : (
        <>
          <div className="reina-tags" role="group" aria-label="ReinaManager 标签筛选（多选为 AND）">
            {shown.map((entry) => {
              const pressed = selectedKeys.includes(entry.key);
              const provenance = providerLabel(entry.provider);
              const accessibleLabel = provenance ? `${entry.name} · ${provenance}` : entry.name;
              return (
                <button
                  key={entry.key}
                  type="button"
                  className="reina-tag"
                  aria-pressed={pressed}
                  aria-label={accessibleLabel}
                  title={accessibleLabel}
                  onClick={() => onToggle?.(entry.key)}
                  disabled={!onToggle}
                >
                  <span className="reina-tag__name">{entry.name}</span>
                  {entry.provider && <span className="reina-tag__providers">{provenance}</span>}
                  {pressed && <X size={11} aria-hidden="true" className="reina-tag__mark" />}
                </button>
              );
            })}
          </div>

          {(hiddenCount > 0 || expanded) && (
            <div className="reina-tags__actions">
              <button
                className="reina-link-button"
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
              >
                {expanded ? '收起' : `展开全部（${entries.length}）`}
              </button>
              {!expanded && hiddenCount > 0 && (
                <span className="reina-hint">还有 {hiddenCount} 个未显示</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
