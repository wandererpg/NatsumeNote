/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReinaSession } from '../../src/shared/reina';
import { ReinaPlayChart } from '../../src/renderer/src/features/reina/ReinaPlayChart';
import { buildDailyPlayData } from '../../src/renderer/src/features/reina/reina-play-chart';

function session(startTime: string, recordedMinutes: number, id = 1): ReinaSession {
  return {
    id,
    gameId: 42,
    startTime,
    endTime: '2026-10-22T00:20:00Z',
    sourceDate: '2020-01-01',
    recordedMinutes,
    recordedDurationSeconds: 99999,
    durationPrecision: 'minute-rounded',
    trackingMode: 'unknown',
    recordKind: 'unknown',
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('daily Reina play data', () => {
  it('merges saved minutes by local start day and sorts dates', () => {
    const data = buildDailyPlayData([
      session(new Date(2026, 9, 21, 21).toISOString(), 90, 1),
      session(new Date(2026, 9, 20, 23).toISOString(), 30, 2),
      session(new Date(2026, 9, 21, 23, 50).toISOString(), 45, 3),
    ]);
    expect(data.map(({ date, minutes }) => ({ date, minutes }))).toEqual([
      { date: '2026-10-20', minutes: 30 },
      { date: '2026-10-21', minutes: 135 },
    ]);
  });

  it('uses the local date rather than the timestamp prefix or source date', () => {
    const localStart = new Date(2026, 9, 21, 0, 15);
    const sameInstant = `${localStart.toISOString().slice(0, -1)}+00:00`;
    expect(buildDailyPlayData([session(sameInstant, 65)])[0]).toMatchObject({ date: '2026-10-21', minutes: 65 });
  });

  it('fills unplayed days with zero without splitting overnight sessions', () => {
    const data = buildDailyPlayData([
      session(new Date(2026, 9, 20, 23, 55).toISOString(), 100, 1),
      session(new Date(2026, 9, 23, 20).toISOString(), 20, 2),
    ]);
    expect(data.map(({ date, minutes }) => [date, minutes])).toEqual([
      ['2026-10-20', 100], ['2026-10-21', 0], ['2026-10-22', 0], ['2026-10-23', 20],
    ]);
  });

  it('keeps very long gaps at zero without allocating every calendar day', () => {
    const data = buildDailyPlayData([
      session(new Date(1900, 0, 1, 12).toISOString(), 30, 1),
      session(new Date(2026, 9, 21, 12).toISOString(), 60, 2),
    ]);
    expect(data).toHaveLength(4);
    expect(data.map(({ minutes }) => minutes)).toEqual([30, 0, 0, 60]);
    expect(data[1].day).toBe(data[0].day + 1);
    expect(data[2].day).toBe(data[3].day - 1);
  });

  it('ignores invalid timestamps and invalid durations', () => {
    expect(buildDailyPlayData([session('invalid', 10), session('2026-10-20T12:00:00Z', Number.NaN), session('2026-10-20T12:00:00Z', -10)])).toEqual([]);
  });
});

describe('ReinaPlayChart', () => {
  it('shows a concise empty state', () => {
    render(<ReinaPlayChart sessions={[]} />);
    expect(screen.getByRole('heading', { name: '每日游玩时长' })).toBeTruthy();
    expect(screen.getByText('暂无游玩记录')).toBeTruthy();
  });

  it('renders a single day with a visible point and keyboard tooltip', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 640, height: 260, top: 0, left: 0, right: 640, bottom: 260, x: 0, y: 0,
      toJSON: () => ({}),
    });
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    const { container } = render(<ReinaPlayChart sessions={[session(new Date(2026, 9, 21, 21).toISOString(), 90)]} />);
    const chart = screen.getByRole('application', { name: '每日游玩时长折线图，使用左右方向键查看每天的时长' });
    expect(chart.getAttribute('tabindex')).toBe('0');
    expect(screen.getByText('10/21')).toBeTruthy();
    expect(container.querySelector('.recharts-line-dot')).toBeTruthy();
    fireEvent.focus(chart);
    await waitFor(() => expect(screen.getByText('1 小时 30 分钟')).toBeTruthy());
    expect(screen.getByText('2026/10/21')).toBeTruthy();
  });
});
