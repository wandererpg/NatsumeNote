import { Sidebar } from './components/layout/Sidebar';
import { PlaylistEditor } from './components/library/PlaylistEditor';
import { AlertCircle, ArrowLeft, BookOpen, Disc3, FolderOpen, Info, Music2, Pencil } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Import, LibraryBig, Play } from 'lucide-react';

import type { LibrarySection, Playlist, AppSettings, BulkTrackOperation, Game, GameMetadataSummary, GameUpdate, MetadataSource, ScanResult, Track, TrackKind } from '../../shared/types';
import { TrackTable } from './components/library/TrackTable';
import { TrackLoadingState } from './components/library/TrackLoadingState';
import { GameEditor } from './components/library/GameEditor';
import { PlaylistPicker } from './components/library/PlaylistPicker';
import { TrackEditor } from './components/library/TrackEditor';
import { BulkDeleteDialog } from './components/library/BulkDeleteDialog';
import { BulkTargetPicker } from './components/library/BulkTargetPicker';
import { BulkTrackToolbar } from './components/library/BulkTrackToolbar';
import { GameOverview } from './components/library/GameOverview';
import { GameShelf } from './components/library/GameShelf';
import { TagChips } from './features/reina/TagChips';
import { useGameTagFilter } from './hooks/useGameTagFilter';
import { useGameMetadata } from './hooks/useGameMetadata';
import { PlayerBar, type PlayerBarProps, type PlayerBarState } from './components/layout/PlayerBar';
import { TitleBar } from './components/layout/TitleBar';
import { ScanDialog } from './components/scanner/ScanDialog';
import { SettingsPanel, type AppearanceDraft, type SettingsChanges } from './components/settings/SettingsPanel';
import { Welcome } from './components/settings/Welcome';
import { JournalWorkspace } from './features/journal/JournalWorkspace';
import { EmptyState } from './components/ui/EmptyState';
import { useLibraryStore } from './stores/libraryStore';
import { usePlayerStore } from './stores/playerStore';
import { useUiStore } from './stores/uiStore';
import { toAppearanceStyle } from './theme/appearance';
import { useNavigationMotion } from './hooks/useNavigationMotion';
import { useSelectionIndicator } from './hooks/useSelectionIndicator';

export interface AppProps {
  onPlayTrack?: (track: Track) => void;
  playTrack?: (track: Track) => void;
  playerState?: Partial<PlayerBarState>;
  playerActions?: Pick<PlayerBarProps, 'onPrevious' | 'onNext' | 'onSeek' | 'onVolumeChange' | 'onPlayModeChange' | 'onTogglePlay'>;
  onImport?: () => void;
}

function getGalMusicApi() {
  if (typeof window === 'undefined') return undefined;
  return window.galMusic;
}

const defaultSettings: AppSettings = {
  libraryPath: '%USERPROFILE%\\Music\\NatsumeNote',
  volume: 0.8,
  playMode: 'list-loop',
  lastTrackId: null,
  voiceThresholdSeconds: 25,
  themeId: 'rain-afterglow',
  fontColor: null,
  background: { imagePath: null, blur: 12, dim: 0.42, scale: 100, positionX: 50, positionY: 50 },
};

function withAppearanceDefaults(settings: Partial<AppSettings> | undefined): AppSettings {
  return {
    ...defaultSettings,
    ...settings,
    fontColor: settings?.fontColor ?? defaultSettings.fontColor,
    background: { ...defaultSettings.background, ...settings?.background },
  };
}

interface BulkResultNotice {
  succeededCount: number;
  failures: Array<{ trackId: string; trackLabel: string; userMessage: string }>;
  warning?: string;
}

type GameViewMode = 'overview' | 'tracks' | 'journal';

export default function App({ onPlayTrack, playTrack: playTrackProp, playerState, playerActions, onImport }: AppProps) {
  const games = useLibraryStore((state) => state.games);
  const tracks = useLibraryStore((state) => state.tracks);
  const playlists = useLibraryStore((state) => state.playlists);
  const isLoadingGames = useLibraryStore((state) => state.isLoadingGames);
  const isLoadingTracks = useLibraryStore((state) => state.isLoadingTracks);
  const error = useLibraryStore((state) => state.error);
  const loadGames = useLibraryStore((state) => state.loadGames);
  const loadTracks = useLibraryStore((state) => state.loadTracks);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const loadPlaylists = useLibraryStore((state) => state.loadPlaylists);
  const removeTrackFromPlaylist = useLibraryStore(state => state.removeTrackFromPlaylist);
  const addTrackToPlaylist = useLibraryStore((state) => state.addTrackToPlaylist);
  const renameTrack = useLibraryStore((state) => state.renameTrack);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const deleteTrack = useLibraryStore((state) => state.deleteTrack);
  const updateGame = useLibraryStore((state) => state.updateGame);
  const deleteGame = useLibraryStore((state) => state.deleteGame);
  const bulkUpdateTracks = useLibraryStore((state) => state.bulkUpdateTracks);

  const selectedGameId = useUiStore((state) => state.selectedGameId);
  const selectedPlaylistId = useUiStore((state) => state.selectedPlaylistId);
  const activeSection = useUiStore((state) => state.activeSection);
  const searchText = useUiStore((state) => state.searchText);
  const setSelectedGame = useUiStore((state) => state.setSelectedGame);
  const setSelectedPlaylist = useUiStore((state) => state.setSelectedPlaylist);
  const setActiveSection = useUiStore((state) => state.setActiveSection);
  const setSearchText = useUiStore((state) => state.setSearchText);
  const setScanDialogOpen = useUiStore((state) => state.setScanDialogOpen);
  const setCurrentModal = useUiStore((state) => state.setCurrentModal);
  const scanDialogOpen = useUiStore((state) => state.scanDialogOpen);
  const currentModal = useUiStore((state) => state.currentModal);

  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [appearancePreview, setAppearancePreview] = useState<AppearanceDraft | null>(null);
  const authorizedBackgroundRef = useRef<string | null>(defaultSettings.background.imagePath);
  const mainContentRef = useRef<HTMLElement>(null);
  const previousQueryRef = useRef<{ context: string; search: string } | null>(null);
  const [welcomeVisible, setWelcomeVisible] = useState(false);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [editingGameMetadata, setEditingGameMetadata] = useState<GameMetadataSummary | null>(null);
  const metadataRequestRef = useRef(0);
  const [playlistTrack, setPlaylistTrack] = useState<Track | null>(null);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const welcomeDismissedRef = useRef(false);
  const [trackKindFilter, setTrackKindFilter] = useState<TrackKind | null>(null);
  const [gameViewMode, setGameViewMode] = useState<GameViewMode>('overview');
  const { metadata: selectedGameMetadata, setMetadata: setSelectedGameMetadata,
    loading: isLoadingGameMetadata, error: gameMetadataError } = useGameMetadata(selectedGameId);
  const gameTagFilter = useGameTagFilter(games, selectedGameMetadata);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [bulkDialog, setBulkDialog] = useState<'move' | 'playlist' | 'delete' | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResultNotice, setBulkResultNotice] = useState<BulkResultNotice | null>(null);
  const bulkContextKey = `${activeSection}\u0000${selectedGameId ?? ''}\u0000${searchText}\u0000${trackKindFilter ?? ''}`;
  const bulkContextKeyRef = useRef(bulkContextKey);
  const bulkContextGenerationRef = useRef(0);
  if (bulkContextKeyRef.current !== bulkContextKey) {
    bulkContextKeyRef.current = bulkContextKey;
    bulkContextGenerationRef.current += 1;
  }

  const playerCurrentTrack = usePlayerStore((state) => state.currentTrack);
  const playerIsPlaying = usePlayerStore((state) => state.isPlaying);
  const playerVolume = usePlayerStore((state) => state.volume);
  const playerProgress = usePlayerStore((state) => state.progress);
  const playerDuration = usePlayerStore((state) => state.duration);
  const playerCurrentTime = usePlayerStore((state) => state.currentTime);
  const playerPlayMode = usePlayerStore((state) => state.playMode);
  const initializePlayer = usePlayerStore((state) => state.initialize);
  const storePlayTrack = usePlayerStore((state) => state.playTrack);
  const storeToggle = usePlayerStore((state) => state.toggle);
  const storePrevious = usePlayerStore((state) => state.previous);
  const storeNext = usePlayerStore((state) => state.next);
  const storeSeek = usePlayerStore((state) => state.seek);
  const storeSetVolume = usePlayerStore((state) => state.setVolume);
  const storeSetPlayMode = usePlayerStore((state) => state.setPlayMode);
  const reconcileLibraryTracks = usePlayerStore((state) => state.reconcileLibraryTracks);

  useEffect(() => {
    let active = true;
    const loadInitialState = async () => {
      const api = getGalMusicApi();
      let loadedSettings = defaultSettings;
      try {
        loadedSettings = withAppearanceDefaults(await api?.getSettings?.());
      } catch {
        // Renderer-only previews can run without the Electron bridge.
      }
      if (!active) return;
      setSettings(loadedSettings);
      authorizedBackgroundRef.current = loadedSettings.background.imagePath;
      const loadedGames = await loadGames();
      await loadPlaylists();
      if (active && !welcomeDismissedRef.current && loadedGames.length === 0) {
        setWelcomeVisible(true);
      }
    };
    void loadInitialState();
    return () => { active = false; };
  }, [loadGames, loadPlaylists]);

  useEffect(() => {
    void initializePlayer().catch(() => undefined);
    return window.galMusic?.onUpdateState?.((state) => {
      if (state.status === 'error') usePlayerStore.getState().finishUpdatePreparation();
    });
  }, [initializePlayer]);

  useEffect(() => {
    if (selectedGameId && !games.some((game) => game.id === selectedGameId)) {
      setSelectedGame(null);
    }
  }, [games, selectedGameId, setSelectedGame]);

  useEffect(() => {
    setTrackKindFilter(null);
  }, [selectedGameId]);

  useEffect(() => {
    setSelectedTrackIds(new Set());
    setBulkDialog(null);
    setBulkResultNotice(null);
  }, [selectedGameId, searchText, trackKindFilter, activeSection]);

  useLayoutEffect(() => {
    const query = {
      section: activeSection,
      gameId: activeSection === 'library' ? selectedGameId : null,
      playlistId: activeSection === 'playlists' ? selectedPlaylistId : null,
      search: searchText,
      kind: activeSection === 'library' && selectedGameId ? trackKindFilter : null,
    };
    const context = JSON.stringify([query.section, query.gameId, query.playlistId, query.kind]);
    const previous = previousQueryRef.current;
    previousQueryRef.current = { context, search: searchText };
    // Only typing needs debounce. Mark navigation as loading before paint so
    // a new heading never flashes the previous page's songs underneath it.
    if (previous?.context !== context || previous.search === searchText || !searchText.trim()) {
      void loadTracks(query);
      return;
    }
    const timer = window.setTimeout(() => { void loadTracks(query); }, 120);
    return () => window.clearTimeout(timer);
  }, [activeSection, loadTracks, searchText, selectedGameId, selectedPlaylistId, trackKindFilter]);

  const selectedGame = useMemo<Game | null>(
    () => games.find((game) => game.id === selectedGameId) ?? null,
    [games, selectedGameId],
  );
  const selectionEnabled = activeSection === 'library' && Boolean(selectedGameId);
  const viewKey = `${activeSection}:${selectedGameId ?? ''}:${selectedPlaylistId ?? ''}`;
  const navigate = useNavigationMotion(mainContentRef, viewKey);
  const kindIndicator = useSelectionIndicator(`${viewKey}:${trackKindFilter ?? 'all'}`);

  useEffect(() => {
    if (mainContentRef.current) mainContentRef.current.scrollTop = 0;
  }, [viewKey]);

  const runBulk = async (operation: BulkTrackOperation) => {
    if (bulkBusy || !selectedGameId || selectedTrackIds.size === 0) return;
    const trackIds = tracks.filter((track) => selectedTrackIds.has(track.id)).map((track) => track.id);
    if (trackIds.length === 0) return;
    const trackLabels = new Map(tracks.map((track) => [track.id, track.displayName]));
    const requestContextGeneration = bulkContextGenerationRef.current;
    setBulkBusy(true);
    setBulkResultNotice(null);
    try {
      const result = await bulkUpdateTracks({ sourceGameId: selectedGameId, trackIds, operation });
      if (!result) return;
      let playbackWarning: string | undefined;
      if (result.succeededIds.length > 0) {
        let refreshedTracks = useLibraryStore.getState().tracks;
        let removedIds = operation.type === 'delete'
          ? new Set(result.succeededIds)
          : new Set<string>();
        if (operation.type === 'move') {
          try {
            const movedTracks = await getGalMusicApi()?.getTracks({
              section: 'library',
              gameId: operation.targetGameId,
              playlistId: null,
              search: '',
              kind: null,
            }) ?? [];
            refreshedTracks = [...refreshedTracks, ...movedTracks];
          } catch {
            // The move is already committed. Remove every successfully moved
            // id from the local queue so Howler cannot retain its old path.
            removedIds = new Set(result.succeededIds);
            playbackWarning = '移动已完成，但播放器刷新失败';
          }
        }
        reconcileLibraryTracks(refreshedTracks, removedIds);
      }
      if (bulkContextGenerationRef.current !== requestContextGeneration) return;
      setSelectedTrackIds(new Set(result.failures.map((failure) => failure.trackId)));
      setBulkDialog(null);
      setBulkResultNotice({
        succeededCount: result.succeededIds.length,
        warning: playbackWarning,
        failures: result.failures.map((failure) => ({
          ...failure,
          trackLabel: trackLabels.get(failure.trackId) ?? failure.trackId,
        })),
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const playTrack = (track: Track) => {
    const mediaRuntimeAvailable = typeof navigator === 'undefined' || !/jsdom/i.test(navigator.userAgent);
    if (mediaRuntimeAvailable) {
      try {
        storePlayTrack(track, tracks);
      } catch {
        // Keep renderer-only previews usable without a media runtime.
      }
    }
    (onPlayTrack ?? playTrackProp)?.(track);
  };

  const activateTrack = (track: Track) => {
    if (currentTrack?.id === track.id) {
      (playerActions?.onTogglePlay ?? storeToggle)();
    } else {
      playTrack(track);
    }
  };

  const handleImport = () => {
    onImport?.();
    if (!onImport) setScanDialogOpen(true);
  };

  const selectSection = (section: LibrarySection) => {
    navigate(`${section}::${section === 'playlists' ? selectedPlaylistId ?? '' : ''}`, () => {
      setActiveSection(section);
      setSearchText('');
      setSelectedGame(null);
      if (section !== 'playlists') setSelectedPlaylist(null);
    });
  };

  const selectGame = (game: Game) => {
    navigate(`library:${game.id}:`, () => {
      if (game.id !== selectedGameId) setTrackKindFilter(null);
      setActiveSection('library');
      setGameViewMode('overview');
      setSelectedPlaylist(null);
      setSelectedGame(game.id);
      setSearchText('');
    });
  };

  const returnToShelf = () => selectSection('library');

  const selectPlaylist = (playlist: Playlist) => {
    navigate(`playlists::${playlist.id}`, () => {
      setActiveSection('playlists');
      setSelectedGame(null);
      setSelectedPlaylist(playlist.id);
      setSearchText('');
    });
  };

  const openGameEditor = async (game: Game) => {
    const requestId = ++metadataRequestRef.current;
    setEditingGame(game);
    setEditingGameMetadata(null);
    setCurrentModal('game-edit');
    try {
      const metadata = await getGalMusicApi()?.getGameMetadata?.(game.id);
      if (requestId === metadataRequestRef.current && metadata) {
        // Metadata enrichment may have downloaded a cover and updated the
        // authoritative game row. Refresh the editor input and library card
        // together so the new cover is visible without a manual reload.
        const refreshedGames = await loadGames();
        if (requestId === metadataRequestRef.current) {
          setEditingGame(refreshedGames.find((item) => item.id === game.id) ?? game);
          setEditingGameMetadata(metadata);
          if (selectedGameId === game.id) setSelectedGameMetadata(metadata);
        }
      }
    } catch {
      // The editor remains usable when an older bridge or a temporary database
      // read failure cannot provide the optional metadata summary.
    }
  };

  const refreshEditingGameMetadata = async (): Promise<GameMetadataSummary | null> => {
    if (!editingGame) return null;
    const api = getGalMusicApi();
    if (!api?.refreshGameMetadata) {
      throw new Error('当前应用未加载资料更新功能，请关闭应用后重新启动开发版。');
    }
    const requestId = metadataRequestRef.current;
    const refreshed = await api.refreshGameMetadata(editingGame.id);
    if (!refreshed) throw new Error('未收到更新后的资料，请重试。');
    if (requestId !== metadataRequestRef.current) return null;
    setEditingGameMetadata(refreshed);
    if (selectedGameId === editingGame.id) setSelectedGameMetadata(refreshed);
    const games = await loadGames();
    const updated = games.find(game => game.id === editingGame.id);
    if (requestId === metadataRequestRef.current && updated) setEditingGame(updated);
    return refreshed;
  };

  const selectEditingGameMetadataCandidate = async (
    gameId: string,
    source: MetadataSource,
    externalId: string,
  ): Promise<GameMetadataSummary | null> => {
    const api = getGalMusicApi();
    if (!api?.selectGameMetadataCandidate) throw new Error('当前程序版本不支持候选确认，请重启应用后再试。');
    const selected = await api.selectGameMetadataCandidate(gameId, source, externalId);
    setEditingGameMetadata(selected);
    if (selectedGameId === gameId) setSelectedGameMetadata(selected);
    const refreshedGames = await loadGames();
    setEditingGame((current) => current?.id === gameId ? refreshedGames.find((game) => game.id === gameId) ?? current : current);
    return selected;
  };

  const translateGameSummary = async (gameId: string, source: MetadataSource): Promise<string> => {
    const api = getGalMusicApi();
    if (!api?.translateGameSummary) throw new Error('当前程序版本不支持简介翻译，请重启应用后再试。');
    const translated = await api.translateGameSummary(gameId, source);
    if (selectedGameId === gameId) setSelectedGameMetadata(translated);
    if (editingGame?.id === gameId) setEditingGameMetadata(translated);
    const summaryZhCn = translated.sources.find((item) => item.source === source)?.summaryZhCn;
    if (!summaryZhCn) throw new Error('翻译服务没有返回有效译文，请稍后重试。');
    return summaryZhCn;
  };

  const saveSettings = async (changes: SettingsChanges) => {
    const api = getGalMusicApi();
    if (api?.saveSettings) await api.saveSettings(changes);
    else if (api) throw new Error('当前程序桥接版本不支持保存外观设置，请重启应用。');
    storeSetVolume(changes.volume);
    storeSetPlayMode(changes.playMode);
    setSettings((current) => ({ ...current, ...changes }));
    authorizedBackgroundRef.current = changes.background.imagePath;
    setAppearancePreview(null);
    const directoryChanged = changes.libraryPath !== settings.libraryPath;
    if (!directoryChanged && !changes.rescanLibrary) return;
    const refreshedGames = await loadGames();
    await loadPlaylists();
    const refreshedTracks = await api?.getTracks?.({ section: 'library', gameId: null }) ?? [];
    const availableIds = new Set(refreshedTracks.map(track => track.id));
    const oldQueue = usePlayerStore.getState().playlist;
    const current = usePlayerStore.getState().currentTrack;
    const removedIds = new Set(oldQueue.filter(track => !availableIds.has(track.id)).map(track => track.id));
    if (current && !availableIds.has(current.id)) removedIds.add(current.id);
    reconcileLibraryTracks(refreshedTracks, removedIds);
    if (refreshedGames.length > 0) {
      welcomeDismissedRef.current = true;
      setWelcomeVisible(false);
    }
    if (directoryChanged) {
      setSelectedGame(null);
      setActiveSection('library');
      setSearchText('');
      setTrackKindFilter(null);
      await loadTracks({ section: 'library', gameId: null, search: '', kind: null });
    } else await loadTracks(useLibraryStore.getState().currentQuery);
  };

  const previewAppearance = (appearance: AppearanceDraft) => {
    setAppearancePreview(appearance);
  };

  const selectBackgroundImage = async () => {
    const api = getGalMusicApi();
    const selected = await api?.selectImage?.() ?? null;
    if (selected) authorizedBackgroundRef.current = selected;
    return selected;
  };

  const saveWelcomePath = async (libraryPath: string) => {
    const api = getGalMusicApi();
    if (api?.setSetting) await api.setSetting('library_path', libraryPath);
    setSettings((current) => ({ ...current, libraryPath }));
    welcomeDismissedRef.current = true;
    setWelcomeVisible(false);
    await loadGames();
  };

  const selectLibraryFolder = async () => getGalMusicApi()?.selectFolder?.() ?? null;

  const handleWelcomeImport = async () => {
    if (!settings.libraryPath) await saveWelcomePath(defaultSettings.libraryPath);
    else {
      welcomeDismissedRef.current = true;
      setWelcomeVisible(false);
    }
    setScanDialogOpen(true);
  };

  const handleScanCompleted = async (_result: ScanResult) => {
    welcomeDismissedRef.current = true;
    setWelcomeVisible(false);
    await loadGames();
    await loadPlaylists();
  };

  const handleOpenFolder = async (track: Track) => {
    await getGalMusicApi()?.openExplorer(track.filePath);
  };

  const currentTrack = playerState?.currentTrack ?? playerCurrentTrack;
  const isPlaying = playerState?.isPlaying ?? playerIsPlaying;
  const volume = playerState?.volume ?? playerVolume;
  // PlayerEngine stores progress as a 0..1 ratio. PlayerBar owns the single
  // conversion to a display percentage so values below 1% are not multiplied
  // twice (0.004 must render as 0.4%, not 40%).
  const progress = playerState?.progress ?? playerProgress;
  const duration = playerState?.duration ?? playerDuration ?? currentTrack?.duration ?? null;
  const currentTime = playerState?.currentTime ?? playerCurrentTime;
  const playMode = playerState?.playMode ?? playerPlayMode;

  const handleSeek = (displayProgress: number) => {
    const nextTime = duration && duration > 0 ? (duration * displayProgress) / 100 : 0;
    if (playerActions?.onSeek) playerActions.onSeek(displayProgress);
    else storeSeek(nextTime);
  };

  const handleSeekTo = (seconds: number) => {
    const nextTime = Math.max(0, seconds);
    if (playerActions?.onSeek) {
      playerActions.onSeek(duration && duration > 0 ? (nextTime / duration) * 100 : 0);
    } else {
      storeSeek(nextTime);
    }
  };

  const effectiveAppearance = appearancePreview ?? settings;
  const currentCoverPath = games.find(game => game.id === currentTrack?.gameId)?.coverPath ?? null;
  const totalMinutes = useMemo(() => Math.round(tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0) / 60), [tracks]);

  return (
    <div className="app-shell app-shell--archive" data-testid="app-shell" data-theme={effectiveAppearance.themeId} style={toAppearanceStyle(effectiveAppearance)}
      onPointerDownCapture={event => { event.currentTarget.dataset.inputModality = 'pointer'; }}
      onKeyDownCapture={event => { event.currentTarget.dataset.inputModality = 'keyboard'; }}>
      <div className="app-shell__user-background" aria-hidden="true" />
      <div className="app-shell__background-shade" aria-hidden="true" />
      <div className="app-shell__backdrop" aria-hidden="true"><span /><span /><span /></div>
      <TitleBar
        searchText={searchText}
        onSearchChange={setSearchText}
        showBack={Boolean(selectedGame)}
        onBack={returnToShelf}
        onImport={handleImport}
        onSettingsClick={() => setCurrentModal('settings')}
      />
      <div className="app-shell__body">
        <Sidebar showGames={Boolean(selectedGame)} games={games} playlists={playlists} selectedGameId={selectedGameId} selectedPlaylistId={selectedPlaylistId} activeSection={activeSection}
          onSelectGame={selectGame} onEditGame={game => { void openGameEditor(game); }} onSelectPlaylist={selectPlaylist}
          onCreatePlaylist={() => setCurrentModal('playlist-edit')} onSelectSection={selectSection} onImport={handleImport} />
        <main
          ref={mainContentRef}
          className="main-content"
          id="main-content"
          data-testid="main-content"
          data-scroll-surface="library"
        >
          {error && <div className="inline-alert" role="alert"><AlertCircle size={16} aria-hidden="true" /><span>{error}</span></div>}

          {(welcomeVisible || games.length === 0) ? (
            <Welcome defaultPath={settings.libraryPath || defaultSettings.libraryPath} onSelectFolder={selectLibraryFolder} onSavePath={saveWelcomePath} onImport={handleWelcomeImport} />
          ) : isLoadingGames && games.length === 0 ? (
            <section className="loading-state" aria-live="polite"><span className="loading-state__spinner" />正在加载音乐库…</section>
          ) : (
            activeSection !== 'library' ? (
              <section className="library-view track-section" data-view-key={viewKey} aria-label="曲目列表">
                <div className="track-section__heading"><h1>{activeSection === 'favorites' ? '收藏' : activeSection === 'recent' ? '最近添加' : activeSection === 'playlists' ? playlists.find(item => item.id === selectedPlaylistId)?.name ?? '播放列表' : '搜索结果'}</h1><span>{tracks.length} 首曲目</span></div>
                {isLoadingTracks ? <TrackLoadingState /> : tracks.length === 0 ? <EmptyState title="暂无曲目" description="导入歌曲或收藏喜欢的音乐后，即可在这里查看。" /> :
                  <TrackTable tracks={tracks} playingTrackId={isPlaying ? currentTrack?.id : null} onPlayTrack={activateTrack}
                    onRename={track => { setEditingTrack(track); setCurrentModal('track-edit'); }}
                    onToggleFavorite={track => { void toggleFavorite(track); }} onAddToPlaylist={track => { setPlaylistTrack(track); setCurrentModal('playlist-add'); }}
                    onDelete={activeSection === 'playlists' ? undefined : track => { void deleteTrack(track.id); }}
                    onRemoveFromPlaylist={activeSection === 'playlists' && selectedPlaylistId ? track => { void removeTrackFromPlaylist(selectedPlaylistId, track.id); } : undefined}
                    scrollContainerRef={mainContentRef} scrollResetKey={viewKey} onOpenFolder={handleOpenFolder} />}
              </section>
            ) : !selectedGame ? (
              <>
              {gameTagFilter.supported && (gameTagFilter.tags.length > 0 || gameTagFilter.selected.length > 0) && (
                <section className="library-tag-filter" aria-label="按作品标签筛选" aria-busy={gameTagFilter.loading}>
                  <TagChips tags={gameTagFilter.tags} selected={gameTagFilter.selected} onToggle={gameTagFilter.toggle} onClear={gameTagFilter.clear} />
                </section>
              )}
              {gameTagFilter.error && <p role="alert">{gameTagFilter.error} <button type="button" className="button button--ghost" onClick={gameTagFilter.retry}>重试</button></p>}
              {gameTagFilter.pendingFilter ? (gameTagFilter.loading ? <p className="loading-state" role="status"><span className="loading-state__spinner" />正在筛选作品…</p> : null) : <GameShelf
                games={gameTagFilter.filteredGames}
                searchText={searchText}
                onSelectGame={selectGame}
                onEditGame={(game) => { void openGameEditor(game); }}
                onImport={handleImport}
              />}
              </>
            ) : (
              <div className="game-room library-view" key={`${viewKey}:${gameViewMode}`}>
                <header className="game-room__hero">
                  <button className="game-room__back" type="button" onClick={returnToShelf}><ArrowLeft size={16} aria-hidden="true" />游戏仓库</button>
                  <div className="game-room__identity">
                    <p className="eyebrow">SELECTED MEMORY</p>
                    <h1>{selectedGame.name}</h1>
                    <span><Disc3 size={13} aria-hidden="true" />{selectedGame.trackCount} 首曲目</span>
                  </div>
                  <button className="button button--ghost game-room__edit" type="button" onClick={() => { void openGameEditor(selectedGame); }}><Pencil size={14} aria-hidden="true" />编辑作品</button>
                </header>

                <nav className="game-room__tabs" aria-label="作品空间">
                  <button type="button" aria-label="打开作品资料" className={gameViewMode === 'overview' ? 'is-active' : ''} aria-current={gameViewMode === 'overview' ? 'page' : undefined} onClick={() => setGameViewMode('overview')}><Info size={15} aria-hidden="true" />作品资料</button>
                  <button type="button" aria-label="打开音乐空间" className={gameViewMode === 'tracks' ? 'is-active' : ''} aria-current={gameViewMode === 'tracks' ? 'page' : undefined} onClick={() => setGameViewMode('tracks')}><Music2 size={15} aria-hidden="true" />音乐</button>
                  <button type="button" aria-label="打开手账空间" className={gameViewMode === 'journal' ? 'is-active' : ''} aria-current={gameViewMode === 'journal' ? 'page' : undefined} onClick={() => setGameViewMode('journal')}><BookOpen size={15} aria-hidden="true" />手账</button>
                </nav>

                {gameViewMode === 'overview' && <GameOverview key={selectedGame.id} game={selectedGame} metadata={selectedGameMetadata} loading={isLoadingGameMetadata} error={gameMetadataError} onEdit={() => { void openGameEditor(selectedGame); }} onTranslateSummary={(source) => translateGameSummary(selectedGame.id, source)} onSelectTag={tag => { gameTagFilter.toggle(tag); returnToShelf(); }} />}

                {gameViewMode === 'tracks' && (
                  <>
                    <div className="track-kind-filter" role="group" aria-label="曲目分类">
                      {([[null, '全部'], ['music', '音乐'], ['voice', '语音']] as const).map(([kind, label]) => (
                        <button key={label} type="button" aria-pressed={trackKindFilter === kind} className={trackKindFilter === kind ? 'is-active' : ''} onClick={() => setTrackKindFilter(kind)}>{label}</button>
                      ))}
                    </div>
                    {bulkResultNotice && (
                      <div className="bulk-result-summary" role="status">
                        <strong>成功 {bulkResultNotice.succeededCount} 首，失败 {bulkResultNotice.failures.length} 首</strong>
                        {bulkResultNotice.warning && <small>{bulkResultNotice.warning}</small>}
                        {bulkResultNotice.failures.length > 0 && (
                          <>
                            <ul>
                              {bulkResultNotice.failures.slice(0, 3).map((failure) => <li key={failure.trackId}>{failure.trackLabel}：{failure.userMessage}</li>)}
                            </ul>
                            {bulkResultNotice.failures.length > 3 && <small>另有 {bulkResultNotice.failures.length - 3} 首失败曲目</small>}
                          </>
                        )}
                      </div>
                    )}
                    {isLoadingTracks ? (
                      <TrackLoadingState />
                    ) : tracks.length === 0 ? (
                      <EmptyState tone="tracks" title={searchText ? '没有匹配的曲目' : '这部作品暂无曲目'} description={searchText ? '换个关键词试试，或清空搜索返回当前列表。' : '导入音乐后，曲目会显示在这部作品的音乐空间。'} actionLabel={searchText ? '清空搜索' : '导入曲目'} onAction={() => searchText ? setSearchText('') : handleImport()} />
                    ) : (
                      <section className="track-section" aria-labelledby="track-section-title">
                        <div className="track-section__heading"><div><h2 id="track-section-title">作品音乐</h2><span>{tracks.length} 首曲目</span></div><div className="track-section__tools"><button className="icon-button icon-button--small" type="button" aria-label="打开曲目文件夹" title="打开曲目文件夹" onClick={() => currentTrack && void handleOpenFolder(currentTrack)}><FolderOpen size={15} aria-hidden="true" /></button></div></div>
                        {selectionEnabled && selectedTrackIds.size > 0 && <BulkTrackToolbar count={selectedTrackIds.size} busy={bulkBusy} onFavorite={() => { void runBulk({ type: 'favorite', isFavorite: true }); }} onUnfavorite={() => { void runBulk({ type: 'favorite', isFavorite: false }); }} onMove={() => setBulkDialog('move')} onAddToPlaylist={() => setBulkDialog('playlist')} onDelete={() => setBulkDialog('delete')} onClear={() => setSelectedTrackIds(new Set())} />}
                        <TrackTable tracks={tracks} playingTrackId={isPlaying ? currentTrack?.id : null} onPlayTrack={activateTrack} onRename={(track) => { setEditingTrack(track); setCurrentModal('track-edit'); }} onToggleFavorite={(track) => { void toggleFavorite(track); }} onAddToPlaylist={(track) => { setPlaylistTrack(track); setCurrentModal('playlist-add'); }} onDelete={(track) => void deleteTrack(track.id)} onOpenFolder={handleOpenFolder} selectionEnabled={selectionEnabled} selectedTrackIds={selectedTrackIds} onSelectionChange={setSelectedTrackIds} selectionDisabled={bulkBusy} scrollContainerRef={mainContentRef}
                              scrollResetKey={`${viewKey}:${searchText}:${trackKindFilter ?? ''}:${gameViewMode}`} />
                      </section>
                    )}
                  </>
                )}

                {gameViewMode === 'journal' && <JournalWorkspace game={selectedGame} tracks={tracks} currentTrack={currentTrack} currentTime={currentTime} onPlayTrack={playTrack} onSeekTo={handleSeekTo} />}
              </div>
            )
          )}
        </main>
      </div>

      <PlayerBar
        coverPath={currentCoverPath}
        playerState={{ currentTrack, isPlaying, volume, progress, duration, currentTime, playMode }}
        onTogglePlay={playerActions?.onTogglePlay ?? storeToggle}
        onPrevious={playerActions?.onPrevious ?? (() => { void storePrevious(); })}
        onNext={playerActions?.onNext ?? (() => { void storeNext(); })}
        onSeek={handleSeek}
        onVolumeChange={playerActions?.onVolumeChange ?? storeSetVolume}
        onPlayModeChange={playerActions?.onPlayModeChange ?? storeSetPlayMode}
      />
      {scanDialogOpen && <ScanDialog onClose={() => setScanDialogOpen(false)} onCompleted={handleScanCompleted} onSelectMetadata={async gameId => {
        const games = await getGalMusicApi()?.getGames?.();
        const game = games?.find(item => item.id === gameId);
        if (game) { setScanDialogOpen(false); await openGameEditor(game); }
      }} />}
      {currentModal === 'settings' && <SettingsPanel settings={settings} onClose={() => { setAppearancePreview(null); setCurrentModal(null); }} onSelectFolder={selectLibraryFolder} onSelectBackground={selectBackgroundImage} onAppearancePreview={previewAppearance} onCancelAppearancePreview={async () => { await getGalMusicApi()?.cancelAppearancePreview?.(); authorizedBackgroundRef.current = settings.background.imagePath; }} onSave={saveSettings} />}
      {currentModal === 'game-edit' && editingGame && (
        <GameEditor
          game={editingGame}
          metadata={editingGameMetadata}
          onRefreshMetadata={refreshEditingGameMetadata}
          onSearchMetadata={async (source, query) => {
            const api = getGalMusicApi();
            if (!api?.searchGameMetadata) throw new Error('请重启开发应用以加载新的资料选择功能。');
            return api.searchGameMetadata(editingGame.id, source, query);
          }}
          onLookupMetadata={async (source, input) => {
            const api = getGalMusicApi();
            if (!api?.lookupGameMetadata) throw new Error('请重启开发应用以加载新的资料选择功能。');
            return api.lookupGameMetadata(editingGame.id, source, input);
          }}
          onOpenMetadataLink={async (source, id) => {
            const api = getGalMusicApi();
            if (!api?.openMetadataLink) throw new Error('请重启开发应用以打开作品链接。');
            await api.openMetadataLink(source, id);
          }}
          onClose={() => { metadataRequestRef.current += 1; setCurrentModal(null); setEditingGame(null); setEditingGameMetadata(null); }}
          onSelectImage={() => getGalMusicApi()?.selectImage?.() ?? Promise.resolve(null)}
          onSave={async (changes: GameUpdate) => {
            const updated = await updateGame(editingGame.id, changes);
            if (updated) {
              if (updated.metadataWarning) {
                setEditingGame(updated);
                setEditingGameMetadata(await getGalMusicApi()?.getGameMetadata?.(updated.id) ?? null);
                await loadGames();
                return updated.metadataWarning;
              }
              setCurrentModal(null);
              setEditingGame(null);
              setEditingGameMetadata(null);
              await loadGames();
            }
          }}
          onDelete={async () => {
            const deleted = await deleteGame(editingGame.id);
            if (!deleted) throw new Error('删除音乐文件夹失败');
            setCurrentModal(null);
            setEditingGame(null);
            setEditingGameMetadata(null);
            setSelectedGame(null);
            await loadGames();
            await loadTracks({ section: 'library', gameId: null, playlistId: null, search: '' });
          }}
        />
      )}
      {currentModal === 'track-edit' && editingTrack && (
        <TrackEditor
          track={editingTrack}
          onClose={() => { setCurrentModal(null); setEditingTrack(null); }}
          onSave={async (customName) => {
            const updated = await renameTrack(editingTrack.id, customName);
            if (updated) {
              setCurrentModal(null);
              setEditingTrack(null);
            }
          }}
        />
      )}
      {currentModal === 'playlist-edit' && <PlaylistEditor onClose={() => setCurrentModal(null)} onSave={async name => {
        const created = await createPlaylist(name);
        if (created) { setCurrentModal(null); selectPlaylist(created); }
      }} />}
      {currentModal === 'playlist-add' && playlistTrack && (
        <PlaylistPicker
          track={playlistTrack}
          playlists={playlists}
          onClose={() => { setCurrentModal(null); setPlaylistTrack(null); }}
          onSelect={async (playlist) => {
            await addTrackToPlaylist(playlist.id, playlistTrack.id);
            setCurrentModal(null);
            setPlaylistTrack(null);
          }}
        />
      )}
      {(bulkDialog === 'move' || bulkDialog === 'playlist') && selectedGameId && (
        <BulkTargetPicker
          mode={bulkDialog === 'move' ? 'game' : 'playlist'}
          games={games}
          playlists={playlists}
          sourceGameId={selectedGameId}
          busy={bulkBusy}
          onClose={() => setBulkDialog(null)}
          onSelect={(targetId) => {
            void runBulk(bulkDialog === 'move'
              ? { type: 'move', targetGameId: targetId }
              : { type: 'playlist-add', playlistId: targetId });
          }}
        />
      )}
      {bulkDialog === 'delete' && (
        <BulkDeleteDialog
          count={selectedTrackIds.size}
          busy={bulkBusy}
          onClose={() => setBulkDialog(null)}
          onConfirm={(deleteFiles) => { void runBulk({ type: 'delete', deleteFiles }); }}
        />
      )}
    </div>
  );
}
