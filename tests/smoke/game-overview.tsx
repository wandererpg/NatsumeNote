import React from 'react';
import { createRoot } from 'react-dom/client';
import { GameOverview } from '../../src/renderer/src/components/library/GameOverview';
import type { Game, GameMetadataSummary } from '../../src/shared/types';
import '../../src/renderer/src/styles/globals.css';

const mode = new URLSearchParams(location.search).get('mode') ?? 'default';
const shortSummary = mode === 'short';
const staffOnly = mode === 'staff-only';
const charactersOnly = mode === 'characters-only';
const characterCount = staffOnly ? 0 : ['six-characters', 'six-narrow', 'stacked', 'long-title'].includes(mode) ? 6 : 3;
const game: Game = {
  id: 'overview-demo', name: 'Amatsutsumi · アマツツミ', coverPath: null, coverSource: null,
  folderPath: 'C:/synthetic/Amatsutsumi', trackCount: 38, createdAt: '', updatedAt: '',
};
const original = Array.from({ length: 24 }, (_, index) =>
  `Chapter ${index + 1}. A young traveler discovers a town beyond the mountains. Words connect the people he meets, and every encounter carries a memory of summer.`,
).join('\n\n') + '\n\n[From [url=https://sekaiproject.com/portfolio-item/amatsutsumi/]Sekai Project[/url]]';
const translated = Array.from({ length: 24 }, (_, index) =>
  `第 ${index + 1} 段。越过山间的道路，少年第一次见到了陌生的小镇。言语将人与人相连，那些看似平凡的相遇，最终成为值得珍藏的夏日记忆。`,
).join('\n\n') + '\n\n[From [url=https://sekaiproject.com/portfolio-item/amatsutsumi/]Sekai Project[/url]]';
const metadata: GameMetadataSummary = {
  gameId: game.id, coverSource: null,
  sources: [{
    source: 'vndb', status: 'matched', queryName: game.name, externalId: 'v18852',
    title: mode === 'long-title' ? 'AmatsutsumiAStoryBeyondTheSummer'.repeat(8) : 'Amatsutsumi',
    titleCn: mode === 'long-title' ? '天津罪 · 言语连接人与人之间的夏日记忆'.repeat(5) : '天津罪',
    developer: mode === 'right-long' ? 'Purple software / Production team and scenario collaboration '.repeat(8) : 'Purple software',
    summary: shortSummary ? '言语将人与人相连，一段值得珍藏的夏日记忆。' : original, summaryZhCn: mode === 'bilingual' ? translated : null,
    releaseDate: '2016-07-29', languages: ['日语', '中文', '英语'], score: 8.4, rank: 120,
    sourceUrl: 'https://vndb.org/v18852', fetchedAt: '2026-10-27T00:00:00.000Z', errorMessage: null,
    tags: ['言灵', '夏日', '乡村', '超自然', '剧情', '恋爱', '日本', '日常', '成长', '情感', '视觉小说', '多结局', '回忆', '人与人之间的联系'],
    characters: Array.from({ length: characterCount }, (_, index) => ({
      externalId: `character-${index}`, name: ['织部心', '朝比奈响子', '水无月萤', '恋冢爱', '织部诚', '水无月苍'][index], originalName: null,
      role: index === 0 ? 'main' : 'side', description: '在这个小镇中相遇的人，各自守护着一段平凡而重要的日常。',
      imageUrl: null, voiceActors: ['演出声优'], sourceUrl: `https://vndb.org/c${index + 1}`,
    })),
    staff: Array.from({ length: charactersOnly ? 0 : 40 }, (_, index) => ({
      externalId: `staff-${index}`, name: `制作成员 ${String(index + 1).padStart(2, '0')}`, originalName: null,
      role: ['scenario', 'art', 'music', 'director'][index % 4], imageUrl: null,
      sourceUrl: `https://vndb.org/s${index + 1}`,
    })),
  }, {
    source: 'bangumi', status: 'failed', queryName: game.name, externalId: null, title: null,
    titleCn: null, developer: null, summary: null, score: null, rank: null,
    fetchedAt: null, errorMessage: 'Synthetic metadata request failed',
  }],
};

Object.defineProperty(window, 'galMusic', { configurable: true, value: {
  getGameTags: async () => [{ name: '游玩中', provider: 'reina' }],
} });
document.documentElement.dataset.theme = mode === 'light' ? 'aquarium-glass' : 'rain-afterglow';
createRoot(document.getElementById('root')!).render(
  <main style={{ width: mode === 'narrow' ? '680px' : 'calc(100% - 80px)', maxWidth: '1240px', margin: '24px auto', padding: '0 0 24px', boxSizing: 'border-box' }}>
    <div className="game-room">
      <nav className="game-room__nav" aria-label="作品栏目" style={{ display: 'flex', gap: '24px', padding: '18px 24px', border: '1px solid var(--line-strong)', borderRadius: '16px 16px 0 0', color: 'var(--teal-0)', background: 'var(--panel-bg)' }}>
        <strong>作品资料</strong><span>游玩记录</span><span>音乐</span><span>手账</span>
      </nav>
      <GameOverview game={game} metadata={metadata} error="Bangumi 资料暂时加载失败。请在编辑作品资料中刷新重试。" onEdit={() => {}} onSelectTag={() => {}} />
    </div>
  </main>,
);
