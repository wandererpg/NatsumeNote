import type { GalMusicAPI } from '../../../shared/ipc';
import type { ReinaEnvelope, ReinaGame, ReinaLink, ReinaQuery, ReinaSession, ReinaStats, ReinaTag } from '../../../shared/reina';
import type { AppSettings, Game, GameMetadataSummary, JournalPage, Playlist, Track, TrackQuery } from '../../../shared/types';

const STORAGE_KEY = 'natsumenote-v13-browser-preview-v1';
const NOW = '2026-10-27T00:00:00.000Z';
const SOURCE_ID = 'preview-reina';
const PRIMARY_GAME_ID = 'preview-amatsutsumi';
const SECOND_GAME_ID = 'preview-atri';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface PreviewState {
  games: Game[];
  tracks: Track[];
  playlists: Playlist[];
  pages: JournalPage[];
  links: ReinaLink[];
  settings: AppSettings;
}

function tags(gameId: string): ReinaTag[] {
  return (gameId === PRIMARY_GAME_ID ? ['剧情', '奇幻', '恋爱', '言灵', '多结局', '夏日'] : ['科幻', '日常', '恋爱', '海边'])
    .map((name, index) => ({ name, provider: index % 2 ? 'bangumi' : 'vndb' }));
}

function makeState(): PreviewState {
  const games: Game[] = [
    { id: PRIMARY_GAME_ID, name: '天津罪', coverPath: null, coverSource: null, trackCount: 3, createdAt: NOW, updatedAt: NOW },
    { id: SECOND_GAME_ID, name: 'ATRI -My Dear Moments-', coverPath: null, coverSource: null, trackCount: 2, createdAt: NOW, updatedAt: NOW },
  ];
  const tracks = games.flatMap(game => Array.from({ length: game.trackCount }, (_, index): Track => ({
    id: `${game.id}-track-${index}`, gameId: game.id, gameName: game.name,
    filePath: `/browser-preview/no-audio/${game.id}-${index}.ogg`, fileName: `preview-${index + 1}.ogg`, customName: null,
    displayName: ['序章 · 预览曲目', '夏日的片刻 · 预览曲目', '故事之后 · 预览曲目'][index],
    duration: 145 + index * 32, kind: 'music', format: 'ogg', fileSize: 0, fileHash: `preview-${game.id}-${index}`,
    trackNumber: index + 1, isFavorite: index === 1, createdAt: NOW, updatedAt: NOW,
  })));
  const pages: JournalPage[] = games.map((game, index) => ({
    id: index === 0 ? 'preview-journal-amatsutsumi' : 'preview-journal-atri', gameId: game.id,
    title: '初见 · 作品手账', position: 0, canvasWidth: 1440, canvasHeight: 1000,
    background: { color: '#12272b', pattern: 'dots' },
    blocks: [
      { id: `${game.id}-text`, type: 'text', x: 92, y: 84, width: 420, height: 240, rotation: -1.5, zIndex: 1, locked: false,
        text: '记录一段想留下的故事。\n\n从一句台词、一段旋律，或一个难忘的瞬间开始。', color: '#e1eee9', backgroundColor: '#233c3d', fontSize: 24, align: 'left' },
      { id: `${game.id}-quote`, type: 'quote', x: 570, y: 150, width: 500, height: 220, rotation: 1, zIndex: 2, locked: false,
        quote: '把喜欢的故事，留在自己的这一页。', attribution: '我的游玩手记', accentColor: '#a6cbbd' },
    ],
    tags: ['初见'], soundtrackTrackId: null, revision: 1, createdAt: NOW, updatedAt: NOW,
  }));
  return { games, tracks, playlists: [], pages,
    links: games.map((game, index) => ({ localGameId: game.id, sourceId: SOURCE_ID, externalGameId: index === 0 ? 42 : 77, externalName: game.name })),
    settings: { libraryPath: '浏览器示例音乐库', volume: 0.65, playMode: 'list-loop', lastTrackId: null, voiceThresholdSeconds: 25,
      themeId: 'rain-afterglow', fontColor: null, background: { imagePath: null, blur: 12, dim: 0.42, scale: 100, positionX: 50, positionY: 50 } },
  };
}

function metadata(game: Game): GameMetadataSummary {
  const primary = game.id === PRIMARY_GAME_ID;
  const paragraphs = primary ? [
    '拥有让言语化为现实之力的少年，离开熟悉的土地，来到一座宁静的小镇。一次偶然的相遇，让他的旅途与这里的人们交织在一起。',
    '夏日的街道、放学后的教室，还有藏在日常背后的秘密。随着彼此逐渐靠近，那些未曾说出口的话语，也开始有了不同的重量。',
    '这是一段关于言语、心意与选择的故事。试着慢慢读下去，寻找属于自己的答案。',
  ] : [
    '在海水逐渐淹没城市的未来，少年与沉睡在海底的少女相遇。日常的片刻，像潮水一样慢慢汇聚成新的希望。',
    '从一盏灯、一顿晚餐，到一起看见的风景，这个夏天的故事由每一次微小的选择写成。',
  ];
  const summary = Array.from({ length: 7 }, () => paragraphs.join('\n\n')).join('\n\n')
    + '\n\n[From [url=https://sekaiproject.com/portfolio-item/amatsutsumi/]Sekai Project[/url]]';
  return { gameId: game.id, coverSource: null, sources: [{
    source: 'vndb', status: 'matched', queryName: game.name, externalId: primary ? 'v18852' : 'v27448',
    title: primary ? 'アマツツミ' : 'ATRI -My Dear Moments-', titleCn: game.name, developer: primary ? 'Purple software' : 'Frontwing · 枕',
    summary, summaryZhCn: summary, score: primary ? 8.4 : 8.2, rank: primary ? 120 : 168,
    releaseDate: primary ? '2016-07-29' : '2020-06-19', languages: ['日语', '简体中文'], platforms: ['Windows'], tags: tags(game.id).map(tag => tag.name),
    sourceUrl: primary ? 'https://vndb.org/v18852' : 'https://vndb.org/v27448', fetchedAt: NOW, errorMessage: null,
    characters: [
      { externalId: 'preview-character-1', name: primary ? '织部心' : '亚托莉', originalName: null, role: '主要角色',
        description: '在平凡的日常中相遇，一起走向故事的下一页。', imageUrl: null, voiceActors: ['角色演出'], sourceUrl: 'https://vndb.org/' },
    ],
    staff: Array.from({ length: 40 }, (_, index) => ({ externalId: `${game.id}-staff-${index}`, name: `制作成员 ${String(index + 1).padStart(2, '0')}`,
      originalName: null, role: ['scenario', 'art', 'music', 'director'][index % 4], imageUrl: null, sourceUrl: 'https://vndb.org/' })),
  }] };
}

function savedSessions(gameId: number): ReinaSession[] {
  const day = (date: number, hour = 20, minute = 0) => new Date(2026, 9, date, hour, minute).toISOString();
  const session = (id: number, startTime: string, recordedMinutes: number): ReinaSession => ({
    id, gameId, startTime, endTime: new Date(new Date(startTime).getTime() + recordedMinutes * 60_000).toISOString(),
    sourceDate: startTime.slice(0, 10), recordedMinutes, recordedDurationSeconds: recordedMinutes * 60,
    durationPrecision: 'minute-rounded', trackingMode: 'unknown', recordKind: 'unknown',
  });
  return [
    ...Array.from({ length: 100 }, (_, index) => session(index + 1, day(1, 12), 3)),
    session(101, day(1), 20), session(102, day(3, 23, 30), 60), session(103, day(5), 75),
  ];
}

/** Browser-only demo data; a real Electron bridge always takes precedence. */
export function installBrowserPreview(): void {
  if (window.galMusic) return;
  let state = makeState();
  let restored = false;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as PreviewState | null;
    if (saved && Array.isArray(saved.games) && Array.isArray(saved.tracks) && Array.isArray(saved.pages)
      && Array.isArray(saved.playlists) && Array.isArray(saved.links) && saved.settings?.background) {
      state = saved;
      restored = true;
    }
  } catch { /* A new or damaged browser preview starts with fresh sample data. */ }
  if (!restored && new URLSearchParams(location.search).get('mode') === 'light') state.settings.themeId = 'aquarium-glass';
  const persist = () => { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); };
  const unavailable = async (): Promise<never> => { throw new Error('此操作需要在 NatsumeNote 桌面开发版中使用。'); };
  const noopSubscription = () => () => undefined;
  const findGame = (id: string) => {
    const game = state.games.find(entry => entry.id === id);
    if (!game) throw new Error('示例作品不存在。');
    return game;
  };
  const readTracks = (query: TrackQuery | string | null): Track[] => {
    const q: TrackQuery = typeof query === 'string' ? { gameId: query } : query ?? {};
    return clone(state.tracks.filter(track => (!q.gameId || track.gameId === q.gameId)
      && (!q.kind || track.kind === q.kind) && (!q.search || `${track.displayName} ${track.gameName}`.toLowerCase().includes(q.search.toLowerCase()))
      && (q.section !== 'favorites' || track.isFavorite)
      && (q.section !== 'playlists' || (state.playlists.find(list => list.id === q.playlistId)?.trackIds.includes(track.id) ?? false))));
  };
  const api: GalMusicAPI = {
    startScan: unavailable, cancelScan: unavailable, addTracks: unavailable, selectFolder: unavailable, selectFiles: unavailable,
    selectImage: unavailable, selectJournalMedia: unavailable, openExplorer: unavailable,
    getGames: async () => clone(state.games), getTracks: async query => readTracks(query), search: async query => readTracks({ search: query }),
    updateTrack: async (id, changes) => {
      const track = state.tracks.find(entry => entry.id === id);
      if (!track) throw new Error('示例曲目不存在。');
      Object.assign(track, changes, { updatedAt: new Date().toISOString() });
      track.displayName = track.customName || track.fileName; persist(); return clone(track);
    },
    deleteTrack: async id => {
      state.tracks = state.tracks.filter(track => track.id !== id);
      for (const game of state.games) game.trackCount = state.tracks.filter(track => track.gameId === game.id).length;
      for (const playlist of state.playlists) playlist.trackIds = playlist.trackIds.filter(trackId => trackId !== id);
      persist();
    },
    bulkUpdateTracks: unavailable,
    getPlaylists: async () => clone(state.playlists),
    createPlaylist: async name => { const playlist = { id: crypto.randomUUID(), name, trackIds: [], createdAt: new Date().toISOString() }; state.playlists.push(playlist); persist(); return clone(playlist); },
    deletePlaylist: async id => { state.playlists = state.playlists.filter(playlist => playlist.id !== id); persist(); },
    addTrackToPlaylist: async (id, trackId) => { const playlist = state.playlists.find(entry => entry.id === id); if (!playlist) throw new Error('歌单不存在。'); if (!playlist.trackIds.includes(trackId)) playlist.trackIds.push(trackId); persist(); },
    removeTrackFromPlaylist: async (id, trackId) => { const playlist = state.playlists.find(entry => entry.id === id); if (playlist) playlist.trackIds = playlist.trackIds.filter(value => value !== trackId); persist(); },
    updateGame: async (id, changes) => {
      if (changes.coverPath !== undefined || changes.coverSelection || changes.metadataSelections) return unavailable();
      const game = findGame(id);
      if (changes.name) {
        game.name = changes.name;
        for (const track of state.tracks) if (track.gameId === id) track.gameName = changes.name;
      }
      game.updatedAt = new Date().toISOString(); persist(); return clone(game);
    },
    deleteGame: async id => { state.games = state.games.filter(game => game.id !== id); state.tracks = state.tracks.filter(track => track.gameId !== id); state.pages = state.pages.filter(page => page.gameId !== id); persist(); },
    getGameMetadata: async id => metadata(findGame(id)), refreshGameMetadata: async id => metadata(findGame(id)),
    translateGameSummary: async id => metadata(findGame(id)), searchGameMetadata: unavailable, lookupGameMetadata: unavailable,
    selectGameMetadataCandidate: unavailable, openMetadataLink: unavailable,
    getJournalPages: async gameId => clone(state.pages.filter(page => page.gameId === gameId)), getJournalAssets: async () => [],
    createJournalPage: async input => {
      findGame(input.gameId);
      const page: JournalPage = { ...clone(input), position: state.pages.filter(entry => entry.gameId === input.gameId).length,
        background: input.background ?? { color: '#12272b', pattern: 'dots' }, blocks: input.blocks ?? [], tags: input.tags ?? [],
        soundtrackTrackId: input.soundtrackTrackId ?? null, revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      state.pages.push(page); persist(); return clone(page);
    },
    saveJournalPage: async draft => {
      const page = state.pages.find(entry => entry.id === draft.id && entry.gameId === draft.gameId);
      if (!page) throw new Error('手账页面不存在。');
      if (page.revision !== draft.revision) throw new Error('手账页面已更新，请重新打开后再试。');
      Object.assign(page, clone(draft), { revision: page.revision + 1, updatedAt: new Date().toISOString() }); persist(); return clone(page);
    },
    deleteJournalPage: async id => { state.pages = state.pages.filter(page => page.id !== id); persist(); },
    getSettings: async () => clone(state.settings),
    setSetting: async (key, value) => {
      const names: Record<string, keyof AppSettings> = { theme_id: 'themeId', volume: 'volume', play_mode: 'playMode', last_track_id: 'lastTrackId', library_path: 'libraryPath', font_color: 'fontColor' };
      const name = names[key]; if (!name) throw new Error('此设置请通过外观设置保存。');
      Object.assign(state.settings, { [name]: name === 'volume' ? Number(value) : value }); persist();
    },
    saveSettings: async changes => { Object.assign(state.settings, clone(changes)); persist(); },
    getPlaybackSnapshot: async () => null,
    onScanProgress: noopSubscription, onScanResult: noopSubscription, onPlayerStateChange: noopSubscription,
    onPlayerTimeUpdate: noopSubscription, onPlayerError: noopSubscription,
    reinaSources: async () => [{ id: SOURCE_ID, label: '浏览器示例记录', connectedAt: NOW }],
    reinaConnect: unavailable, reinaDisconnect: unavailable, reinaBatchPreview: unavailable, reinaBatchApply: unavailable,
    reinaLinks: async gameId => clone(state.links.filter(link => !gameId || link.localGameId === gameId)),
    reinaBind: async link => { state.links = state.links.filter(entry => !(entry.localGameId === link.localGameId && entry.sourceId === link.sourceId)); state.links.push(clone(link)); persist(); },
    reinaUnbind: async (gameId, sourceId) => { state.links = state.links.filter(link => !(link.localGameId === gameId && link.sourceId === sourceId)); persist(); },
    getGameTags: async gameId => gameId ? tags(gameId) : [...new Map(state.games.flatMap(game => tags(game.id)).map(tag => [`${tag.provider}:${tag.name}`, tag])).values()],
    filterGamesByTags: async selected => clone(state.games.filter(game => selected.every(key => tags(game.id).some(tag => `${tag.provider}:${tag.name}` === key)))),
    reinaQuery: async <T>(tool: string, query: ReinaQuery): Promise<ReinaEnvelope<T>> => {
      const snapshotId = `preview-snapshot-${query.gameId ?? 'all'}`;
      if (query.sourceId !== SOURCE_ID || (query.snapshotId && query.snapshotId !== snapshotId)) throw new Error('示例记录已更新，请刷新重试。');
      const externalGames: ReinaGame[] = state.games.map(game => ({ id: game.id === PRIMARY_GAME_ID ? 42 : 77, name: game.name,
        externalIds: [{ provider: 'vndb', id: game.id === PRIMARY_GAME_ID ? 'v18852' : 'v27448' }], tags: tags(game.id), unsupportedTagProviders: [] }));
      const sessions = savedSessions(query.gameId ?? 42).filter(session => (!query.from || session.startTime >= query.from) && (!query.to || session.startTime < query.to));
      const stats: ReinaStats = { sourceTotalMinutes: query.gameId === 77 ? 845 : 1872, sourceSessionCount: 103,
        sourceLastPlayed: sessions.at(-1)?.endTime ?? null, sessionTotalMinutes: sessions.reduce((sum, session) => sum + session.recordedMinutes, 0), sessionCount: sessions.length, liveSession: false };
      const offset = query.cursor ? Number(query.cursor.replace('offset:', '')) : 0;
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('示例记录分页无效。');
      const limit = Math.max(1, Math.min(query.limit ?? 100, 100));
      let data: unknown = [];
      let nextCursor: string | null = null;
      if (tool === 'reina_get_stats') data = stats;
      else if (tool === 'reina_list_sessions') { data = sessions.slice(offset, offset + limit); nextCursor = offset + limit < sessions.length ? `offset:${offset + limit}` : null; }
      else if (tool === 'reina_get_connection') data = { readable: true, liveSession: false, schemaProfile: 'browser-preview' };
      else if (tool === 'reina_get_tags') data = tags(query.gameId === 77 ? SECOND_GAME_ID : PRIMARY_GAME_ID);
      else if (tool === 'reina_list_games') data = externalGames.filter(game => (!query.query || game.name.toLowerCase().includes(query.query.toLowerCase()))
        && (!query.externalId || game.externalIds.some(entry => entry.id === query.externalId && (!query.provider || entry.provider === query.provider))));
      return { contractVersion: 1, sourceApp: 'ReinaManager', sourceId: SOURCE_ID, snapshotId, fetchedAt: NOW, warnings: [], data: clone(data) as T, nextCursor };
    },
  };
  Object.defineProperty(window, 'galMusic', { configurable: true, value: api });
}
