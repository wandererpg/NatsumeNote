import type {
  GameMetadataSummary,
  JournalAsset,
  JournalBlock,
  JournalPage,
  Track,
} from '../../../../shared/types';
import { toJournalMediaUrl } from '../../../../shared/journal-media-url';
import { formatPlayDate, formatPlayMinutes, formatPlaySessionRange, formatSnapshotFetchedAt } from './journal-play-session';

export interface JournalExportOptions {
  gameName: string;
  metadata?: GameMetadataSummary | null;
  tracks: Track[];
  assets: JournalAsset[];
  coverUrl?: string | null;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function lines(value: string, max = 8): string[] {
  return value.split(/\r?\n/).slice(0, max);
}

function textSvg(value: string, x: number, y: number, size: number, color: string, anchor: 'start' | 'middle' | 'end' = 'start', weight = 400): string {
  return lines(value).map((line, index) => (
    `<text x="${x}" y="${y + index * Math.max(size * 1.35, 16)}" fill="${escapeXml(color)}" font-size="${size}" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-weight="${weight}" text-anchor="${anchor}">${escapeXml(line || ' ')}</text>`
  )).join('');
}

function blockTransform(block: JournalBlock): string {
  return `translate(${block.x} ${block.y}) rotate(${block.rotation} ${block.width / 2} ${block.height / 2})`;
}

function renderTextBlock(block: Extract<JournalBlock, { type: 'text' }>): string {
  const anchor = block.align === 'center' ? 'middle' : block.align === 'right' ? 'end' : 'start';
  const x = block.align === 'center' ? block.width / 2 : block.align === 'right' ? block.width - 20 : 20;
  return `<rect width="${block.width}" height="${block.height}" rx="2" fill="${escapeXml(block.backgroundColor)}" stroke="#d7c46f" stroke-width="1"/><rect x="${block.width / 2 - 29}" y="-7" width="58" height="18" rx="1" fill="#efe4c8" fill-opacity=".78" transform="rotate(-2 ${block.width / 2} 2)"/>${textSvg(block.text || '点击编辑这张便签', x, 38, block.fontSize, block.color, anchor)}`;
}

function renderQuoteBlock(block: Extract<JournalBlock, { type: 'quote' }>): string {
  return `<rect width="${block.width}" height="${block.height}" rx="18" fill="#fffdf8" stroke="${escapeXml(block.accentColor)}" stroke-width="3"/><rect width="8" height="${block.height}" rx="4" fill="${escapeXml(block.accentColor)}"/>${textSvg(`“${block.quote}”`, 32, 52, 24, '#342d2a', 'start', 600)}${block.attribution ? textSvg(`— ${block.attribution}`, 32, block.height - 24, 15, '#8b746c') : ''}`;
}

function renderMediaBlock(block: Extract<JournalBlock, { type: 'image' | 'video' }>, asset: JournalAsset | undefined): string {
  const inner = asset && block.type === 'image'
    ? `<image href="${escapeXml(toJournalMediaUrl(asset.filePath))}" x="8" y="8" width="${block.width - 16}" height="${block.height - 48}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect x="8" y="8" width="${block.width - 16}" height="${block.height - 48}" rx="12" fill="#302d3a"/><circle cx="${block.width / 2}" cy="${(block.height - 40) / 2}" r="28" fill="#f6c98d"/><path d="M ${block.width / 2 - 8} ${(block.height - 40) / 2 - 13} L ${block.width / 2 + 14} ${(block.height - 40) / 2} L ${block.width / 2 - 8} ${(block.height - 40) / 2 + 13} Z" fill="#302d3a"/>`;
  return `<rect width="${block.width}" height="${block.height}" rx="18" fill="#fffdf8" stroke="#eaded1" stroke-width="2"/>${inner}${textSvg(block.caption || asset?.fileName || (block.type === 'image' ? '图片素材' : '视频素材'), 18, block.height - 18, 14, '#725f58')}`;
}

function renderTrackBlock(block: Extract<JournalBlock, { type: 'track' }>, track: Track | undefined): string {
  const label = track?.displayName ?? '未找到曲目';
  const detail = block.startTime === null || block.startTime === undefined ? '从头播放' : `从 ${formatSeconds(block.startTime)} 开始`;
  return `<rect width="${block.width}" height="${block.height}" rx="18" fill="#f4ede8" stroke="#d7b39e" stroke-width="2"/><circle cx="42" cy="52" r="24" fill="#d77863"/><path d="M 35 39 L 54 52 L 35 65 Z" fill="#fffdf8"/>${textSvg('音乐片段', 82, 38, 13, '#9a6659', 'start', 700)}${textSvg(label, 82, 70, 20, '#342d2a', 'start', 600)}${textSvg(detail, 82, 100, 13, '#725f58')}${block.note ? textSvg(block.note, 20, block.height - 18, 13, '#725f58') : ''}`;
}

function renderPlaySessionBlock(block: Extract<JournalBlock, { type: 'play-session' }>): string {
  const snapshot = block.snapshot;
  const rows = snapshot.sessions.slice(0, 4);
  const rowSvg = rows.map((session, index) => (
    `<text x="24" y="${134 + index * 24}" fill="#725f58" font-size="12" font-family="Segoe UI, Microsoft YaHei, sans-serif">${escapeXml(`${formatPlayDate(session)} ${formatPlaySessionRange(session)} · ${session.recordedMinutes} 分钟`)}</text>`
  )).join('');
  const more = snapshot.sessions.length > rows.length
    ? `<text x="24" y="${134 + rows.length * 24}" fill="#9a6659" font-size="11" font-family="Segoe UI, Microsoft YaHei, sans-serif">${escapeXml(`另有 ${snapshot.sessions.length - rows.length} 次记录`)}</text>`
    : '';
  return `<rect width="${block.width}" height="${block.height}" rx="18" fill="#fff8ef" stroke="#d7b39e" stroke-width="2"/><rect width="8" height="${block.height}" rx="4" fill="#c86b58"/><text x="24" y="34" fill="#9a6659" font-size="12" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-weight="700">游玩记录</text><text x="24" y="64" fill="#342d2a" font-size="20" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-weight="600">${escapeXml(snapshot.externalGameName)}</text><text x="24" y="92" fill="#c86b58" font-size="16" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-weight="600">${escapeXml(formatPlayMinutes(snapshot.stats.sessionTotalMinutes))}</text><text x="24" y="114" fill="#725f58" font-size="12" font-family="Segoe UI, Microsoft YaHei, sans-serif">${escapeXml(`${snapshot.stats.sessionCount} 次 · 截至 ${formatSnapshotFetchedAt(snapshot.fetchedAt)}`)}</text>${rowSvg}${more}<text x="24" y="${block.height - 16}" fill="#9a6659" font-size="10" font-family="Segoe UI, Microsoft YaHei, sans-serif">${escapeXml(`${snapshot.sourceApp} · ${snapshot.sourceId}`)}</text>`;
}

function renderBlock(block: JournalBlock, options: JournalExportOptions): string {
  const asset = block.type === 'image' || block.type === 'video' ? options.assets.find((item) => item.id === block.assetId) : undefined;
  const track = block.type === 'track' ? options.tracks.find((item) => item.id === block.trackId) : undefined;
  let body: string;
  switch (block.type) {
    case 'text':
      body = renderTextBlock(block);
      break;
    case 'quote':
      body = renderQuoteBlock(block);
      break;
    case 'image':
    case 'video':
      body = renderMediaBlock(block, asset);
      break;
    case 'track':
      body = renderTrackBlock(block, track);
      break;
    case 'play-session':
      body = renderPlaySessionBlock(block);
      break;
    case 'details':
      return '';
  }
  return `<g transform="${blockTransform(block)}" opacity="${block.locked ? 0.98 : 1}">${body}</g>`;
}

function backgroundPattern(page: JournalPage): string {
  if (page.background.pattern === 'plain') return '';
  if (page.background.pattern === 'grid') {
    return `<pattern id="journal-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="#d8c4b5" stroke-opacity=".25"/></pattern><rect width="100%" height="100%" fill="url(#journal-grid)"/>`;
  }
  if (page.background.pattern === 'dots') {
    return `<pattern id="journal-dots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.5" fill="#b99c8c" fill-opacity=".32"/></pattern><rect width="100%" height="100%" fill="url(#journal-dots)"/>`;
  }
  return `<pattern id="journal-paper" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M 0 12 C 12 8 24 16 48 10 M 0 38 C 16 34 28 42 48 36" fill="none" stroke="#dac4b2" stroke-opacity=".12"/></pattern><rect width="100%" height="100%" fill="url(#journal-paper)"/>`;
}

export function journalPageToSvg(page: JournalPage, options: JournalExportOptions): string {
  const blocks = [...page.blocks].sort((left, right) => left.zIndex - right.zIndex || left.id.localeCompare(right.id));
  const cover = options.coverUrl
    ? `<image href="${escapeXml(options.coverUrl)}" x="${page.canvasWidth - 150}" y="32" width="104" height="104" preserveAspectRatio="xMidYMid slice" opacity=".9"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.canvasWidth}" height="${page.canvasHeight}" viewBox="0 0 ${page.canvasWidth} ${page.canvasHeight}"><defs>${backgroundPattern(page)}</defs><rect width="100%" height="100%" fill="${escapeXml(page.background.color)}"/><rect x="0" y="0" width="100%" height="100%" fill="transparent"/>${cover}<text x="32" y="58" fill="#342d2a" font-size="32" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-weight="700">${escapeXml(page.title || '手账页面')}</text><text x="34" y="88" fill="#9a6659" font-size="14" font-family="Segoe UI, Microsoft YaHei, sans-serif">${escapeXml(options.gameName)}</text>${blocks.map((block) => renderBlock(block, options)).join('')}</svg>`;
}

export function journalExportFileName(gameName: string, pageTitle: string): string {
  const safe = `${gameName}-${pageTitle}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  return `${safe || '手账页面'}.svg`;
}

export function downloadJournalPageSvg(page: JournalPage, options: JournalExportOptions): void {
  const svg = journalPageToSvg(page, options);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = journalExportFileName(options.gameName, page.title);
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadJournalPagePng(page: JournalPage, options: JournalExportOptions): Promise<void> {
  const svg = journalPageToSvg(page, options);
  const canvas = document.createElement('canvas');
  canvas.width = page.canvasWidth;
  canvas.height = page.canvasHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    downloadJournalPageSvg(page, options);
    return;
  }
  const image = new Image();
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve) => {
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = svgUrl;
  });
  if (!image.naturalWidth && !image.width) {
    downloadJournalPageSvg(page, options);
    return;
  }
  context.drawImage(image, 0, 0, page.canvasWidth, page.canvasHeight);
  const anchor = document.createElement('a');
  anchor.href = canvas.toDataURL('image/png');
  anchor.download = journalExportFileName(options.gameName, page.title).replace(/\.svg$/u, '.png');
  anchor.click();
}

export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '00:00';
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}
