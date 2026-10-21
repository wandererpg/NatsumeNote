import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Game } from '../../../shared/types';
import type { ReinaTag } from '../../../shared/reina';
import { getErrorMessage } from '../../../shared/errors';
export function useGameTagFilter(games: Game[], refreshKey?: unknown) {
  const [tags, setTags] = useState<ReinaTag[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [ids, setIds] = useState<Set<string> | null>(null);
  const [resultKey, setResultKey] = useState('[]');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const supported = typeof window.galMusic?.getGameTags === 'function' && typeof window.galMusic?.filterGamesByTags === 'function';
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('reina-tags-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('reina-tags-changed', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => {
    const request = ++generation.current;
    if (!supported) return;
    let active = true;
    setLoading(true); setError(null);
    void (async () => {
      try {
        const available = await window.galMusic.getGameTags!();
        const filtered = selected.length ? await window.galMusic.filterGamesByTags!(selected) : null;
        if (!active || request !== generation.current) return;
        setTags(available); setIds(filtered ? new Set(filtered.map(game => game.id)) : null); setResultKey(JSON.stringify(selected));
      } catch (reason) { if (active && request === generation.current) setError(getErrorMessage(reason, '无法筛选作品标签，请重试。')); }
      finally { if (active && request === generation.current) setLoading(false); }
    })();
    return () => { active = false; };
  }, [games, selected, revision, supported, refreshKey]);
  const toggle = useCallback((name: string) => setSelected(previous => previous.includes(name) ? previous.filter(item => item !== name) : [...previous, name]), []);
  const clear = useCallback(() => setSelected([]), []);
  const filteredGames = useMemo(() => selected.length && ids ? games.filter(game => ids.has(game.id)) : games, [games, selected.length, ids]);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  return { tags, selected, toggle, clear, filteredGames, loading, error, supported, pendingFilter: selected.length > 0 && resultKey !== JSON.stringify(selected), retry };
}
