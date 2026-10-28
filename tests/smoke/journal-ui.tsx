import React from 'react';
import { createRoot } from 'react-dom/client';
import { JournalWorkspace } from '../../src/renderer/src/features/journal/JournalWorkspace';
import { createBlankJournalPage, createJournalTextBlock, createJournalQuoteBlock, createJournalTrackBlock } from '../../src/renderer/src/features/journal/journal-model';
import type { Game, JournalPage, Track } from '../../src/shared/types';
import '../../src/renderer/src/styles/globals.css';

const mode = new URLSearchParams(location.search).get('mode') ?? 'default';
const game: Game = { id: 'demo', name: 'ATRI — My Dear Moments', folderPath: 'C:/synthetic/ATRI', coverPath: null, coverSource: null, trackCount: 1, createdAt: '', updatedAt: '' };
const track: Track = { id: 'song', gameId: game.id, gameName: game.name, filePath: 'C:/synthetic/theme.ogg', fileName: 'theme.ogg', displayName: 'Dear Moments', customName: null, duration: 240, kind: 'music', format: 'ogg', fileSize: 1, fileHash: 'synthetic', trackNumber: 1, isFavorite: true, createdAt: '', updatedAt: '' };
let pages: JournalPage[] = [
  { ...createBlankJournalPage(game.id, 'first', '在夏天结束之前'), tags: ['初见', '夏日'], blocks: [
    { ...createJournalTextBlock('note', 54, 150), width: 266, height: 300, text: '今天也想记住的事\n\n海风、黄昏，还有耳机里循环的这首歌。\n\n有些瞬间，值得慢慢收藏。', backgroundColor: '#f6e9ba', rotation: -2 },
    { ...createJournalQuoteBlock('quote', 368, 156), width: 500, height: 174, quote: '在这个逐渐沉没的世界里，\n我找到了你。', attribution: '写给这个夏天' },
    { ...createJournalTrackBlock('music', track.id, 36, 374, 378), width: 470, note: '闭上眼睛，就又回到了那个夏天。' },
  ] },
  { ...createBlankJournalPage(game.id, 'second', '关于那些小小的日常'), blocks: [] },
];
if (mode === 'long') {
  game.name = '那些值得慢慢珍藏的日常与回忆 — Summer Pockets REFLECTION BLUE · 超长作品标题展示';
  pages[0].title = '那些看似平凡却再也无法忘记的、小小的日常与回忆，以及我们共同度过的夏天';
}
if (mode === 'crowded') pages[0].blocks = Array.from({ length: 40 }, (_, index) => ({ ...createJournalTextBlock(`note-${index}`, 42 + index % 8 * 100, 155 + Math.floor(index / 8) * 75, index), width: 170, height: 135, text: `记忆片段 ${index + 1}`, rotation: index % 5 - 2 }));
Object.defineProperty(window, 'galMusic', { configurable: true, value: {
  getJournalPages: async () => { if (mode === 'loading') return new Promise(() => {}); if (mode === 'error') throw new Error('暂时无法读取手账，请重试。'); return mode === 'empty' ? [pages[1]] : pages; },
  getJournalAssets: async () => [],
  saveJournalPage: async (draft: JournalPage) => { const saved = { ...draft, revision: draft.revision + 1 }; pages = pages.map(page => page.id === saved.id ? saved : page); return saved; },
  createJournalPage: async (input: Partial<JournalPage>) => { const page = { ...createBlankJournalPage(game.id, input.id!, input.title), ...input }; pages.push(page); return page; },
  deleteJournalPage: async () => {},
  selectJournalMedia: async () => [],
} });
document.documentElement.dataset.theme = mode === 'light' ? 'aquarium-glass' : mode.startsWith('theme-') ? mode.slice(6) : 'rain-afterglow';
createRoot(document.getElementById('root')!).render(
  <main style={{ padding: '20px', maxWidth: mode === 'compact' ? '660px' : undefined, margin: 'auto', minHeight: '100vh', boxSizing: 'border-box', background: 'var(--ink-0)' }}>
    <JournalWorkspace game={game} tracks={[track]} onPlayTrack={() => {}} onSeekTo={() => {}} />
  </main>,
);
