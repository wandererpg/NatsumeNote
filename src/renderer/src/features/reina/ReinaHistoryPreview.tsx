import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { ReinaStats } from '../../../../shared/reina';
import { getReinaBridge, reinaErrorMessage } from './reina-bridge';
import { asReinaStats } from './reina-data';
import { formatMinutes, formatSessionCount } from './reina-format';

/** A read-only preview, before the user confirms a local game association. */
export function ReinaHistoryPreview({ sourceId, gameId }: { sourceId: string; gameId: number }) {
  const [stats, setStats] = useState<ReinaStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setError(null);
    setWarnings([]);
    void (async () => {
      try {
        const bridge = getReinaBridge();
        if (typeof bridge?.reinaQuery !== 'function') throw new Error('当前版本未接入游玩记录查询接口。');
        const result = await bridge.reinaQuery<ReinaStats>('reina_get_stats', { sourceId, gameId });
        if (cancelled) return;
        const next = asReinaStats(result.data);
        if (!next) throw new Error('来源未返回可读取的游玩统计。');
        setStats(next);
        setWarnings(Array.isArray(result.warnings) ? result.warnings : []);
      } catch (reason) {
        if (!cancelled) setError(reinaErrorMessage(reason, '无法预览历史时长，请重试。'));
      }
    })();
    return () => { cancelled = true; };
  }, [sourceId, gameId, attempt]);

  return (
    <section className="reina-notice reina-history-preview" aria-label="历史时长预览" aria-busy={!stats && !error}>
      <h4>历史时长预览</h4>
      {error ? (
        <div className="reina-error" role="alert">
          <span>{error}</span>
          <button className="reina-link-button" type="button" onClick={() => setAttempt((value) => value + 1)}>
            重试预览
          </button>
        </div>
      ) : stats ? (
        <>
          <p>来源历史累计 · 全生命周期</p>
          <p className="reina-history-preview__total">{formatMinutes(stats.sourceTotalMinutes)}</p>
          <p>{stats.sourceSessionCount === null ? '来源未提供记录次数' : `来源记录 ${formatSessionCount(stats.sourceSessionCount)}`}</p>
          <p>已保存会话合计 {formatMinutes(stats.sessionTotalMinutes)} · {formatSessionCount(stats.sessionCount)}；与历史累计不相加。</p>
          {warnings.map((warning, index) => <p key={index}>{warning}</p>)}
        </>
      ) : (
        <p className="reina-loading" role="status">
          <LoaderCircle className="spin" size={15} aria-hidden="true" />正在预览历史时长…
        </p>
      )}
      <p>确认作品后点击「关联此作品」，即可读取全部历史时长和游玩时段；无需重新计时。</p>
    </section>
  );
}
