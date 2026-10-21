import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReinaSource } from '../../../../shared/reina';
import { getReinaBridge, hasBridgeMethod, reinaErrorMessage } from './reina-bridge';

export interface ReinaSourcesResult {
  sources: ReinaSource[] | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  bridgeReady: boolean;
}

/**
 * Reads the list of connected ReinaManager databases. Each component instance
 * owns its own request generation so a slow reload can never overwrite a newer
 * result, and nothing is written back after unmount.
 */
export function useReinaSources(): ReinaSourcesResult {
  const [sources, setSources] = useState<ReinaSource[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    if (!mountedRef.current) return;
    const request = requestRef.current + 1;
    requestRef.current = request;
    const isCurrent = (): boolean => mountedRef.current && request === requestRef.current;

    setLoading(true);
    setError(null);

    const bridge = getReinaBridge();
    if (!bridge || !hasBridgeMethod(bridge, 'reinaSources')) {
      if (isCurrent()) {
        setSources(null);
        setError('当前版本未接入 ReinaManager 桥接，无法读取已连接的来源。');
        setLoading(false);
      }
      return;
    }

    try {
      const list = await bridge.reinaSources();
      if (!isCurrent()) return;
      setSources(Array.isArray(list) ? list : []);
    } catch (loadError) {
      if (!isCurrent()) return;
      setError(reinaErrorMessage(loadError, '无法读取已连接的 ReinaManager 来源。'));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void reload();
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
    };
  }, [reload]);

  return { sources, loading, error, reload, bridgeReady: Boolean(getReinaBridge()) };
}
