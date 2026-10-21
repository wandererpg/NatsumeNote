import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameMetadataSummary } from '../../../shared/types';
import { getErrorMessage } from '../../../shared/errors';
import { REINA_TAGS_CHANGED_EVENT } from '../features/reina/reina-events';

export function useGameMetadata(gameId: string | null) {
  const [metadata, updateMetadata] = useState<GameMetadataSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const setMetadata = useCallback((value: GameMetadataSummary | null) => {
    generation.current += 1;
    updateMetadata(value); setLoading(false); setError(null);
  }, []);

  useEffect(() => {
    let active = true;
    updateMetadata(null); setError(null); setLoading(false);
    const load = async () => {
      const api = window.galMusic;
      if (!gameId || !api?.getGameMetadata) return;
      const request = ++generation.current;
      const isCurrent = () => active && request === generation.current;
      setLoading(true); setError(null);
      try {
        const result = await api.getGameMetadata(gameId);
        if (isCurrent()) updateMetadata(result);
      } catch (reason) {
        if (isCurrent()) setError(getErrorMessage(reason, '作品资料暂时加载失败，请在编辑作品资料中刷新重试。'));
      } finally {
        if (isCurrent()) setLoading(false);
      }
    };
    const reload = () => { void load(); };
    void load();
    window.addEventListener(REINA_TAGS_CHANGED_EVENT, reload);
    return () => {
      active = false; generation.current += 1;
      window.removeEventListener(REINA_TAGS_CHANGED_EVENT, reload);
    };
  }, [gameId]);

  return { metadata, setMetadata, loading, error };
}
