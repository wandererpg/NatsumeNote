import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReinaConnectionPanel } from '../../src/renderer/src/features/reina/ReinaConnectionPanel';
import { ReinaGamePanel } from '../../src/renderer/src/features/reina/ReinaGamePanel';
import { TagChips } from '../../src/renderer/src/features/reina/TagChips';
import '../../src/renderer/src/styles/globals.css';

const mode = location.hash.slice(1) || 'connected';
const source = { id: 'synthetic', label: '合成数据库 · 测试来源', connectedAt: '2026-10-21T01:00:00Z' };
const name = 'Summer Pockets REFLECTION BLUE · 长作品名称展示测试';
const tags = Array.from({ length: 16 }, (_, index) => ({ name: ['剧情', '校园', '恋爱', '夏日', '日常', '催泪', '奇幻', '冒险'][index % 8] + (index > 7 ? '长标签文本展示' : ''), provider: index % 2 ? 'vndb' as const : 'bangumi' as const }));
const sessions = [{ id: 1, gameId: 42, startTime: '2026-10-20T13:00:00Z', endTime: '2026-10-20T14:00:00Z', sourceDate: '2026-10-20', recordedMinutes: 12, recordedDurationSeconds: 720, durationPrecision: 'minute-rounded', trackingMode: 'unknown', recordKind: 'unknown' }];
const stats = { sourceTotalMinutes: 99, sourceSessionCount: 3, sourceLastPlayed: '2026-10-20T14:00:00Z', sessionTotalMinutes: 12, sessionCount: 1, liveSession: false };
const envelope = (data: unknown) => ({ contractVersion: 1, sourceApp: 'ReinaManager', sourceId: source.id, snapshotId: 'synthetic-snapshot', fetchedAt: '2026-10-21T01:00:00Z', warnings: ['来源累计与已保存会话合计不一致；两种口径分别展示。'], data, nextCursor: null });
Object.defineProperty(window, 'galMusic', { value: {
  reinaSources: async () => {
    if (mode === 'loading') return new Promise(() => {});
    if (mode === 'error') throw new Error('无法读取数据库，请重新选择兼容的 ReinaManager 数据库。');
    return mode === 'empty' ? [] : [source];
  },
  reinaLinks: async () => mode === 'connected' ? [{ localGameId: 'local', sourceId: source.id, externalGameId: 42, externalName: name }] : [],
  reinaQuery: async (tool: string) => envelope(tool === 'reina_get_stats' ? stats : tool === 'reina_list_sessions' ? sessions : tool === 'reina_get_connection' ? { readable: true, liveSession: false, schemaProfile: 'synthetic-audited' } : tool === 'reina_list_games' ? [{ id: 42, name, externalIds: [], tags, unsupportedTagProviders: [] }] : []),
  reinaBatchPreview: async () => {
    if (mode === 'batch-loading') return new Promise(() => {});
    if (mode === 'batch-error') throw new Error('无法读取批量导入预览，请重试。');
    return { token: 'synthetic-batch', libraryPath: 'D:/Music/作品文件夹/长目录名称测试', warnings: [],
      localGames: [{ id: 'local', name }],
      rows: Array.from({ length: 28 }, (_, index) => ({ externalGameId: index + 1, name: `${name} 第${index + 1}部`, action: index === 0 ? 'review' : 'create', reason: index === 0 ? '存在多个匹配，请手动选择' : '未找到对应作品，将新建作品和文件夹', alreadyLinked: false, newName: `${name} (${index + 1})` })) };
  },
  reinaBatchApply: async () => ({ created: 27, linked: 1, skipped: 0 }),
  reinaConnect: async () => source,
  reinaDisconnect: async () => {},
  reinaBind: async () => {},
  reinaUnbind: async () => {},
} });

function Fixture() {
  const [selected, setSelected] = React.useState<string[]>(['bangumi:剧情']);
  return <main style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
    <section className="library-tag-filter"><TagChips tags={tags} selected={selected} onToggle={tag => setSelected(current => current.includes(tag) ? current.filter(value => value !== tag) : [...current, tag])} onClear={() => setSelected([])} /></section>
    <ReinaConnectionPanel />
    <div style={{ marginTop: 24 }}><ReinaGamePanel gameId="local" gameName={name} /></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
