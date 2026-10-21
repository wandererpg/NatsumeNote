import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from 'lucide-react';
import type { ReinaConnection, ReinaSource } from '../../../../shared/reina';
import { getReinaBridge, hasBridgeMethod, reinaErrorMessage } from './reina-bridge';
import { useReinaSources } from './useReinaSources';
import { formatDateTime } from './reina-format';
import { notifyReinaTagsChanged } from './reina-events';
import './reina.css';

type TestEntry =
  | {
      status: 'ok';
      schemaProfile: string;
      fetchedAt: string;
      warnings: string[];
    }
  | { status: 'error'; message: string };

type BusyState = { sourceId: string; action: 'test' | 'disconnect' } | null;

/**
 * Settings → data connection. Lets the user pick a native ReinaManager
 * database through the main-process file dialog, verify that it is readable,
 * list the connected sources and disconnect one. Nothing here writes to the
 * source database.
 */
export function ReinaConnectionPanel() {
  const { sources, loading, error, reload, bridgeReady } = useReinaSources();
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  const [tests, setTests] = useState<Record<string, TestEntry>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const connect = async () => {
    if (connecting || busy) return;
    const bridge = getReinaBridge();
    if (!bridge || !hasBridgeMethod(bridge, 'reinaConnect')) {
      setActionError('当前版本未接入 ReinaManager 数据库选择接口。');
      return;
    }
    setConnecting(true);
    setActionError(null);
    setStatusMessage(null);
    try {
      const source = await bridge.reinaConnect();
      if (source) notifyReinaTagsChanged();
      if (!mountedRef.current) return;
      if (source) {
        setStatusMessage(`已连接 ${source.label || 'ReinaManager 数据库'}。`);
        await reload();
      } else {
        setStatusMessage('已取消选择数据库，未创建连接。');
      }
    } catch (connectError) {
      if (mountedRef.current) {
        setActionError(reinaErrorMessage(connectError, '无法连接所选数据库。'));
      }
    } finally {
      if (mountedRef.current) setConnecting(false);
    }
  };

  const testConnection = async (source: ReinaSource) => {
    if (busy || connecting) return;
    const bridge = getReinaBridge();
    if (!bridge || !hasBridgeMethod(bridge, 'reinaQuery')) {
      setActionError('当前版本未接入 ReinaManager 查询接口。');
      return;
    }
    setBusy({ sourceId: source.id, action: 'test' });
    setActionError(null);
    try {
      const envelope = await bridge.reinaQuery<ReinaConnection>('reina_get_connection', {
        sourceId: source.id,
      });
      if (!mountedRef.current) return;
      const data = envelope.data as Partial<ReinaConnection> | null | undefined;
      if (data?.readable !== true) {
        setTests((previous) => ({
          ...previous,
          [source.id]: { status: 'error', message: '数据库不可读取或版本不受支持。' },
        }));
        return;
      }
      const warnings = Array.isArray(envelope.warnings) ? envelope.warnings : [];
      setTests((previous) => ({
        ...previous,
        [source.id]: {
          status: 'ok',
          schemaProfile: typeof data.schemaProfile === 'string' ? data.schemaProfile : '未知',
          fetchedAt: envelope.fetchedAt || '',
          warnings,
        },
      }));
    } catch (testError) {
      if (!mountedRef.current) return;
      setTests((previous) => ({
        ...previous,
        [source.id]: {
          status: 'error',
          message: reinaErrorMessage(testError, '测试读取失败。'),
        },
      }));
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  const disconnect = async (source: ReinaSource) => {
    if (busy || connecting) return;
    const bridge = getReinaBridge();
    if (!bridge || !hasBridgeMethod(bridge, 'reinaDisconnect')) {
      setActionError('当前版本未接入 ReinaManager 断开接口。');
      return;
    }
    setBusy({ sourceId: source.id, action: 'disconnect' });
    setActionError(null);
    setStatusMessage(null);
    try {
      await bridge.reinaDisconnect(source.id);
      notifyReinaTagsChanged();
      if (!mountedRef.current) return;
      setTests((previous) => {
        const next: Record<string, TestEntry> = {};
        for (const [id, entry] of Object.entries(previous)) {
          if (id !== source.id) next[id] = entry;
        }
        return next;
      });
      setStatusMessage(`已断开 ${source.label || 'ReinaManager 数据库'}，本地关联和来源标签缓存已清理。音乐、手账卡片和来源记录保留。`);
      await reload();
    } catch (disconnectError) {
      if (mountedRef.current) {
        setActionError(reinaErrorMessage(disconnectError, '断开来源失败。'));
      }
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  };

  return (
    <section className="reina-panel reina-connection" aria-labelledby="reina-connection-title">
      <header className="reina-panel__header">
        <div>
          <p className="reina-eyebrow">
            <Database size={13} aria-hidden="true" />
            REINAMANAGER
          </p>
          <h3 className="reina-panel__heading" id="reina-connection-title">
            数据连接
          </h3>
          <p className="reina-panel__subtitle">
            只读读取 ReinaManager 已保存的游玩记录。断开会清理本地作品关联与来源标签缓存，音乐、手账卡片和来源数据保留。来源被替换时可重新选择原路径，旧关联将等待逐个确认。
          </p>
        </div>
      </header>

      {!bridgeReady && (
        <p className="reina-error" role="alert">
          当前版本未接入 ReinaManager 桥接（window.galMusic），无法读取游玩记录。
        </p>
      )}

      <div className="reina-panel__actions">
        <button
          className="button button--primary"
          type="button"
          onClick={() => void connect()}
          disabled={!bridgeReady || connecting || Boolean(busy)}
        >
          {connecting ? (
            <LoaderCircle className="spin" size={15} aria-hidden="true" />
          ) : (
            <FolderOpen size={15} aria-hidden="true" />
          )}
          {connecting ? '正在选择数据库…' : '选择 ReinaManager 数据库…'}
        </button>
        <button
          className="button button--ghost"
          type="button"
          onClick={() => void reload()}
          disabled={loading || connecting || Boolean(busy)}
        >
          <RefreshCw className={loading ? 'spin' : undefined} size={14} aria-hidden="true" />
          刷新来源
        </button>
      </div>

      <p className="reina-hint">
        通过系统文件选择器指定 <code>reina_manager.db</code>；安装版与便携版的数据目录不同，请按实际安装位置选择。取消选择不会产生错误。
      </p>

      {statusMessage && (
        <p className="reina-status" role="status">
          {statusMessage}
        </p>
      )}
      {actionError && (
        <p className="reina-error" role="alert">
          {actionError}
        </p>
      )}

      {loading && !sources ? (
        <p className="reina-loading" role="status">
          <LoaderCircle className="spin" size={15} aria-hidden="true" />
          正在读取已连接的来源…
        </p>
      ) : error && !bridgeReady ? null : error ? (
        <div className="reina-error" role="alert">
          <span>{error}</span>
          <button className="reina-link-button" type="button" onClick={() => void reload()}>
            重试
          </button>
        </div>
      ) : !sources || sources.length === 0 ? (
        <div className="reina-empty">
          <p>尚未连接 ReinaManager。</p>
          <p className="reina-hint">
            选择其 <code>{'<便携版目录>/resources/data/reina_manager.db'}</code> 后会以只读方式读取；连接信息只保存在本机。
          </p>
        </div>
      ) : (
        <ul className="reina-source-list">
          {sources.map((source) => {
            const testing = busy?.sourceId === source.id && busy.action === 'test';
            const disconnecting = busy?.sourceId === source.id && busy.action === 'disconnect';
            const test = tests[source.id];
            return (
              <li className="reina-source" key={source.id}>
                <div className="reina-source__head">
                  <div className="reina-source__title">
                    <Database size={14} aria-hidden="true" />
                    <strong>{source.label || 'ReinaManager 数据库'}</strong>
                    <code className="reina-source__id" title={source.id}>
                      #{source.id.slice(0, 8)}
                    </code>
                  </div>
                  <p className="reina-source__meta">
                    连接于 {formatDateTime(source.connectedAt) ?? source.connectedAt}
                  </p>
                </div>
                <div className="reina-source__actions">
                  <button
                    className="button button--ghost button--small"
                    type="button"
                    onClick={() => void testConnection(source)}
                    disabled={connecting || Boolean(busy)}
                  >
                    {testing ? (
                      <LoaderCircle className="spin" size={14} aria-hidden="true" />
                    ) : (
                      <ShieldCheck size={14} aria-hidden="true" />
                    )}
                    测试读取
                  </button>
                  <button
                    className="button button--ghost button--small"
                    type="button"
                    onClick={() => void disconnect(source)}
                    disabled={connecting || Boolean(busy)}
                  >
                    {disconnecting ? (
                      <LoaderCircle className="spin" size={14} aria-hidden="true" />
                    ) : (
                      <Unplug size={14} aria-hidden="true" />
                    )}
                    断开连接
                  </button>
                </div>
                {test && test.status === 'ok' && (
                  <div className="reina-source__result" role="status">
                    <p>
                      <CheckCircle2 size={13} aria-hidden="true" /> 数据库可读取 · Schema{' '}
                      {test.schemaProfile}
                    </p>
                    <p className="reina-source__result-meta">
                      上次读取 {formatDateTime(test.fetchedAt) ?? '时间未知'} · 只表示文件可读，不代表 ReinaManager 正在运行；无法显示实时计时。
                    </p>
                    {test.warnings.length > 0 && (
                      <div className="reina-warnings">
                        <p className="reina-warnings__title">
                          <AlertTriangle size={12} aria-hidden="true" />
                          来源提示
                        </p>
                        <ul>
                          {test.warnings.map((warning, index) => (
                            <li key={`${index}-${warning}`}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                {test && test.status === 'error' && (
                  <p className="reina-error" role="alert">
                    <AlertTriangle size={13} aria-hidden="true" /> {test.message}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
