/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installBrowserPreview } from '../../src/renderer/src/dev/browser-preview';
import type { ReinaGame, ReinaSession, ReinaStats } from '../../src/shared/reina';

const STORAGE_KEY = 'natsumenote-v13-browser-preview-v1';
const GAME_ID = 'preview-amatsutsumi';
const SOURCE_ID = 'preview-reina';

function reloadPreview() {
  Reflect.deleteProperty(window, 'galMusic');
  installBrowserPreview();
  return window.galMusic;
}

describe('Vite browser preview bridge', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'galMusic');
    localStorage.clear();
    history.replaceState(null, '', '/');
  });
  afterEach(() => {
    Reflect.deleteProperty(window, 'galMusic');
    localStorage.clear();
    history.replaceState(null, '', '/');
  });

  it('preserves an existing desktop bridge', () => {
    const desktopBridge = { desktop: true };
    Object.defineProperty(window, 'galMusic', { configurable: true, value: desktopBridge });
    installBrowserPreview();
    expect(window.galMusic).toBe(desktopBridge);
    expect(localStorage.length).toBe(0);
  });

  it('provides full overview data with scrollable content and stable source identities', async () => {
    const api = reloadPreview();
    const games = await api.getGames();
    expect(games.map(game => game.name)).toEqual(['天津罪', 'ATRI -My Dear Moments-']);
    const metadata = await api.getGameMetadata!(GAME_ID);
    expect(metadata.sources[0].summaryZhCn!.length).toBeGreaterThan(1000);
    expect(metadata.sources[0].staff).toHaveLength(40);
    expect(await api.getGameTags!(GAME_ID)).toContainEqual({ name: '剧情', provider: 'vndb' });
    await api.deleteGame!(GAME_ID);
    const external = await api.reinaQuery!<ReinaGame[]>('reina_list_games', { sourceId: SOURCE_ID });
    expect(external.data).toEqual([expect.objectContaining({ id: 77, name: 'ATRI -My Dear Moments-' })]);
  });

  it('supplies all saved sessions across snapshot-aware pages and an independent source total', async () => {
    const api = reloadPreview();
    const query = { sourceId: SOURCE_ID, gameId: 42, limit: 100 };
    const first = await api.reinaQuery!<ReinaSession[]>('reina_list_sessions', query);
    expect(first.data).toHaveLength(100);
    expect(first.nextCursor).toBe('offset:100');
    const second = await api.reinaQuery!<ReinaSession[]>('reina_list_sessions', {
      ...query, cursor: first.nextCursor!, snapshotId: first.snapshotId!,
    });
    expect(second.data).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    const all = [...first.data, ...second.data];
    expect(all.reduce((sum, session) => sum + session.recordedMinutes, 0)).toBe(455);
    expect(all.filter(session => new Date(session.startTime).getDate() === 1)
      .reduce((sum, session) => sum + session.recordedMinutes, 0)).toBe(320);
    const stats = await api.reinaQuery!<ReinaStats>('reina_get_stats', query);
    expect(stats.data.sourceTotalMinutes).toBe(1872);
    await expect(api.reinaQuery!('reina_list_sessions', { ...query, snapshotId: 'outdated' }))
      .rejects.toThrow('请刷新重试');
  });

  it('saves journal changes across reloads and rejects an outdated revision', async () => {
    const api = reloadPreview();
    const original = (await api.getJournalPages!(GAME_ID))[0];
    const updated = await api.saveJournalPage!({ ...original, title: '我的新手账', tags: ['已保存'] });
    expect(updated.revision).toBe(original.revision + 1);
    await expect(api.saveJournalPage!(original)).rejects.toThrow('页面已更新');
    const restored = (await reloadPreview().getJournalPages!(GAME_ID))[0];
    expect(restored.title).toBe('我的新手账');
    expect(restored.tags).toEqual(['已保存']);
    expect(restored.revision).toBe(updated.revision);
    expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
  });

  it('uses the light query for first use and keeps a later saved theme on reload', async () => {
    history.replaceState(null, '', '/?mode=light');
    const api = reloadPreview();
    expect((await api.getSettings()).themeId).toBe('aquarium-glass');
    await api.saveSettings!({ ...await api.getSettings(), themeId: 'rain-afterglow', fontColor: null });
    expect((await reloadPreview().getSettings()).themeId).toBe('rain-afterglow');
  });

  it('updates track counts and game names consistently', async () => {
    const api = reloadPreview();
    const track = (await api.getTracks(GAME_ID))[0];
    await api.updateGame!(GAME_ID, { name: '示例重命名' });
    expect((await api.getTracks(GAME_ID))[0].gameName).toBe('示例重命名');
    await api.deleteTrack(track.id);
    expect((await api.getGames())[0].trackCount).toBe(2);
  });

  it('rejects desktop-only file actions with a clear message', async () => {
    const api = reloadPreview();
    await expect(api.selectFolder()).rejects.toThrow('桌面开发版');
    await expect(api.updateGame!(GAME_ID, { coverPath: 'C:/example.png' })).rejects.toThrow('桌面开发版');
  });

  it('recovers from damaged preview storage without exposing real data', async () => {
    localStorage.setItem(STORAGE_KEY, '{broken');
    expect(await reloadPreview().getGames()).toHaveLength(2);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ games: [], tracks: [] }));
    expect(await reloadPreview().getGames()).toHaveLength(2);
  });
});
