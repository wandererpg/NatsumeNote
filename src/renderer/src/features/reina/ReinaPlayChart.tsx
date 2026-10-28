import { useId, useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ReinaSession } from '../../../../shared/reina';
import { formatMinutes } from './reina-format';
import { buildDailyPlayData, playDayLabel, type DailyPlayPoint } from './reina-play-chart';
import './reina-play-chart.css';

interface PlayTooltipProps {
  active?: boolean;
  payload?: readonly { payload?: DailyPlayPoint }[];
}

function PlayTooltip({ active, payload }: PlayTooltipProps) {
  const entry = payload?.[0]?.payload;
  if (!active || !entry) return null;
  return (
    <div className="reina-play-chart__tooltip">
      <span>{playDayLabel(entry.day, true)}</span>
      <strong>{formatMinutes(entry.minutes)}</strong>
    </div>
  );
}

export function ReinaPlayChart({ sessions }: { sessions: ReinaSession[] }) {
  const headingId = useId();
  const data = useMemo(() => buildDailyPlayData(sessions), [sessions]);
  const first = data[0];
  const last = data[data.length - 1];
  const spansYears = first && last && first.date.slice(0, 4) !== last.date.slice(0, 4);

  return (
    <figure className="reina-play-chart" aria-labelledby={headingId}>
      <figcaption className="reina-play-chart__header">
        <h4 id={headingId}>每日游玩时长</h4>
      </figcaption>
      {!data.length ? (
        <p className="reina-play-chart__empty">暂无游玩记录</p>
      ) : (
        <div className="reina-play-chart__plot">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 640, height: 260 }}>
            <LineChart
              data={data}
              margin={{ top: 18, right: 16, bottom: 6, left: 0 }}
              accessibilityLayer
              aria-label="每日游玩时长折线图，使用左右方向键查看每天的时长"
            >
              <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
              <XAxis
                dataKey="day"
                type="number"
                domain={first.day === last.day ? [first.day - 1, last.day + 1] : ['dataMin', 'dataMax']}
                ticks={first.day === last.day ? [first.day] : undefined}
                tickFormatter={(day: number) => playDayLabel(day, Boolean(spansYears))}
                tick={{ fill: 'var(--muted-0)', fontSize: 11 }}
                minTickGap={32}
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tickMargin={12}
              />
              <YAxis
                domain={[0, 'auto']}
                tickFormatter={(minutes: number) => `${Number((minutes / 60).toFixed(2))}h`}
                tick={{ fill: 'var(--muted-0)', fontSize: 11 }}
                width={46}
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tickMargin={10}
              />
              <Tooltip
                content={<PlayTooltip />}
                cursor={{ stroke: 'var(--line-strong)', strokeDasharray: '4 4' }}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="minutes"
                name="游玩时长"
                stroke="var(--teal-0)"
                strokeWidth={2.5}
                dot={data.length <= 45 ? { r: 3, strokeWidth: 2, fill: 'var(--ink-1)' } : false}
                activeDot={{ r: 5, strokeWidth: 3, stroke: 'var(--ink-1)', fill: 'var(--teal-0)' }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </figure>
  );
}
