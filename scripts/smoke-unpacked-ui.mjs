import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';

const root = process.cwd();
const archive = path.resolve(process.argv[2] ?? 'release-v_1.2-update/win-unpacked/resources/app.asar');
if (!fs.statSync(archive).isFile()) throw new Error('Expected an existing app.asar.');
const folder = fs.mkdtempSync(path.join(root, '.unpacked-ui-smoke-'));
const artifacts = path.join(root, 'artifacts', 'unpacked-ui');
fs.mkdirSync(artifacts, { recursive: true });

// Runs the archived main process, preload and renderer. Only the native window
// is replaced with an invisible offscreen subclass; the IPC bridge stays real.
async function harness() {
  const fs = require('node:fs');
  const path = require('node:path');
  const Module = require('node:module');
  const { randomUUID } = require('node:crypto');
  const electron = require('electron');
  const { app, session } = electron;
  const archive = process.env.NATSUME_SMOKE_ARCHIVE;
  const root = process.env.NATSUME_SMOKE_WORKSPACE;
  const artifacts = process.env.NATSUME_SMOKE_ARTIFACTS;
  const userData = path.join(__dirname, 'user-data');
  const music = path.join(__dirname, 'music');
  for (const directory of [userData, music, path.join(music, 'NatsumeNote')]) fs.mkdirSync(directory, { recursive: true });
  app.setPath('userData', userData);
  app.setPath('sessionData', userData);
  app.setPath('music', music);
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  if (app.isPackaged) throw new Error('Smoke runtime must disable packaged update checks.');
  const packaged = require(path.join(archive, 'package.json'));
  if (packaged.version !== '1.3.0') throw new Error('Archive version is ' + packaged.version);
  const Database = require(path.join(archive, 'node_modules/better-sqlite3'));
  const gameId = randomUUID();
  const emptyId = randomUUID();
  const sourceId = randomUUID();
  const sourcePath = path.join(__dirname, 'synthetic-reina.db');
  const source = new Database(sourcePath);
  source.exec(fs.readFileSync(path.join(root, 'tests/fixtures/reina-manager-audited.sql'), 'utf8'));
  for (const [id, name] of [[42, '天津罪'], [43, '尚未游玩的作品']]) source.prepare('INSERT INTO games(id,custom_data) VALUES (?,?)').run(id, JSON.stringify({ name, tags: ['剧情'] }));
  const addSession = source.prepare('INSERT INTO game_sessions VALUES (?,?,?,?,?,?)');
  const epoch = value => Math.floor(new Date(value).getTime() / 1000);
  const begin = epoch('2026-10-01T08:00:00+08:00');
  for (let index = 0; index < 100; index++) addSession.run(index + 1, 42, begin + index * 240, begin + index * 240 + 180, 3, '2026-10-01');
  addSession.run(101, 42, epoch('2026-10-01T19:00:00+08:00'), epoch('2026-10-01T19:20:00+08:00'), 20, '2026-10-01');
  addSession.run(102, 42, epoch('2026-10-03T23:30:00+08:00'), epoch('2026-10-04T00:30:00+08:00'), 60, '2026-10-03');
  addSession.run(103, 42, epoch('2026-10-05T19:00:00+08:00'), epoch('2026-10-05T20:15:00+08:00'), 75, '2026-10-05');
  source.prepare('INSERT INTO game_statistics VALUES (?,?,?,?,?)').run(42, 1872, 103, epoch('2026-10-05T20:15:00+08:00'), '{}');
  source.prepare('INSERT INTO game_statistics VALUES (?,?,?,?,?)').run(43, 0, 0, null, '{}');
  source.close();
  const initialSourceBytes = fs.readFileSync(sourcePath);
  const initialIdentity = fs.statSync(sourcePath);
  let mainWindow;
  let seeded = false;
  const errors = [];
  const externalRequests = [];
  function seed() {
    if (seeded) return;
    seeded = true;
    const db = new Database(path.join(userData, 'galmusic.db'));
    db.prepare('INSERT INTO games(id,name) VALUES (?,?)').run(gameId, '天津罪');
    db.prepare('INSERT INTO games(id,name) VALUES (?,?)').run(emptyId, '尚未游玩的作品');
    const summary = Array.from({ length: 9 }, () => '拥有让言语化为现实之力的少年，在夏日小镇遇见了命运相连的人们。记录一段关于言语、心意与选择的故事。').join('\n\n');
    const staff = Array.from({ length: 40 }, (_, index) => ({ externalId: String(index + 1), name: '测试主创 ' + (index + 1), originalName: null, role: '制作', imageUrl: null, sourceUrl: 'https://vndb.org/s1' }));
    const candidate = { externalId: '42', title: '天津罪', titleCn: '天津罪', aliases: [], developer: 'Purple software', summary: summary + '\n[From [url=https://sekaiproject.com/]Sekai Project[/url]]', score: 8.4, rank: 120, releaseDate: '2016-07-29', languages: ['ja', 'zh-Hans'], platforms: ['PC'], tags: ['剧情', '奇幻', '恋爱'], imageUrl: null, sourceUrl: 'https://vndb.org/v42', characters: [], staff };
    for (const id of [gameId, emptyId]) {
      db.prepare('INSERT INTO game_sources(game_id,source,external_id,query_name,status,data_json,fetched_at) VALUES (?,?,?,?,?,?,?)').run(id, 'vndb', '42', '天津罪', 'matched', JSON.stringify({ matched: candidate, candidates: [candidate], summaryZhCn: summary, creditsLoaded: true, creditsError: null }), new Date().toISOString());
      db.prepare('INSERT INTO game_sources(game_id,source,query_name,status,data_json,fetched_at) VALUES (?,?,?,?,?,?)').run(id, 'bangumi', '天津罪', 'no_match', JSON.stringify({ matched: null, candidates: [], creditsLoaded: true }), new Date().toISOString());
    }
    db.prepare('INSERT INTO external_play_sources(id,label,authorized_path,file_identity,connected_at) VALUES (?,?,?,?,?)').run(sourceId, '隔离验收测试来源', sourcePath, `${initialIdentity.dev}:${initialIdentity.ino}:${initialIdentity.birthtimeMs}`, new Date().toISOString());
    db.close();
  }
  class OffscreenWindow extends electron.BrowserWindow {
    constructor(options) {
      seed();
      super({ ...options, width: 1440, height: 960, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } });
      mainWindow = this;
      this.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
    }
    show() {}
    showInactive() {}
  }
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'electron') return { ...electron, BrowserWindow: OffscreenWindow };
    return originalLoad.call(this, request, parent, isMain);
  };
  // Metadata is fully pre-cached in synthetic rows. This guards accidental
  // Node fetches too, while file protocols and the real Reina worker still run.
  globalThis.fetch = async () => { throw new Error('Network is disabled during isolated UI acceptance.'); };
  require(path.join(archive, packaged.main));
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => { externalRequests.push(details.url); callback({ cancel: true }); });
  const pause = () => new Promise(resolve => setTimeout(resolve, 150));
  for (let attempt = 0; !mainWindow && attempt < 100; attempt++) await pause();
  if (!mainWindow) throw new Error('Archived main did not create a window.');
  const evaluate = fn => mainWindow.webContents.executeJavaScript('(' + fn.toString() + ')()');
  const waitFor = async (fn, label) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(fn)) return; await pause(); }
    throw new Error(label + ': ' + await evaluate(() => document.body.textContent));
  };
  const screenshot = async name => { await pause(); fs.writeFileSync(path.join(artifacts, name + '.png'), (await mainWindow.webContents.capturePage()).toPNG()); };
  const click = async label => {
    const result = await mainWindow.webContents.executeJavaScript(`(() => { const node = document.querySelector(${JSON.stringify('[aria-label="' + label + '"]')}); if(!node) return false; node.click(); return true; })()`);
    if (!result) throw new Error('Missing control: ' + label);
    await pause();
  };
  const openGame = async id => {
    await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-testid="game-item-${id}"]').click()`);
    await waitFor(() => Boolean(document.querySelector('.game-overview')), 'Overview did not open');
  };
  await waitFor(() => document.body.textContent.includes('v_1.3') && typeof window.galMusic?.reinaQuery === 'function', 'Actual preload or version badge missing');
  const bridge = await evaluate(() => ({ frozen: Object.isFrozen(window.galMusic), createPage: typeof window.galMusic.createJournalPage, savePage: typeof window.galMusic.saveJournalPage }));
  if (!bridge.frozen || bridge.createPage !== 'function' || bridge.savePage !== 'function') throw new Error('Expected the actual context-isolated preload bridge: ' + JSON.stringify(bridge));
  await waitFor(() => document.querySelectorAll('[data-testid^="game-item-"]').length === 2, 'Synthetic library did not load');
  await screenshot('library');
  await openGame(gameId);
  await waitFor(() => document.querySelectorAll('.staff-list li').length === 40, 'Cached metadata did not load through real IPC');
  const overview = await evaluate(() => ({ summary: document.querySelector('.summary-reader__scroll').scrollHeight > document.querySelector('.summary-reader__scroll').clientHeight, staff: document.querySelector('.staff-list').scrollHeight > document.querySelector('.staff-list').clientHeight, rightTags: document.querySelector('.game-overview__facts').contains(document.querySelector('.game-overview__tags')), sourceMarkup: document.body.textContent.includes('[From') || document.body.textContent.includes('[url=') }));
  if (!overview.summary || !overview.staff || !overview.rightTags || overview.sourceMarkup) throw new Error('Overview layout failed: ' + JSON.stringify(overview));
  await screenshot('overview');
  await click('打开游玩记录');
  await waitFor(() => Boolean(document.querySelector('.game-records')), 'Records tab did not open');
  await screenshot('records-unbound');
  // The selection/list preview and binding both travel through the real IPC
  // handlers and the archived utility-process reader, never a fake galMusic.
  await mainWindow.webContents.executeJavaScript(`(async () => { await window.galMusic.reinaQuery('reina_list_games',{sourceId:${JSON.stringify(sourceId)},limit:100}); await window.galMusic.reinaBind({localGameId:${JSON.stringify(gameId)},sourceId:${JSON.stringify(sourceId)},externalGameId:42,externalName:'天津罪'}); await window.galMusic.reinaBind({localGameId:${JSON.stringify(emptyId)},sourceId:${JSON.stringify(sourceId)},externalGameId:43,externalName:'尚未游玩的作品'}); })()`);
  await click('打开作品资料');
  await click('打开游玩记录');
  await waitFor(() => Boolean(document.querySelector('.recharts-line-curve')) && !document.querySelector('.reina-play[aria-busy="true"]'), 'Real Reina daily chart did not load');
  const records = await evaluate(() => {
    const play = document.querySelector('.reina-play');
    const source = document.querySelector('[aria-labelledby="reina-source-title"]');
    const binding = document.querySelector('[aria-labelledby="reina-binding-title"]');
    const text = document.querySelector('.game-records').textContent;
    return { total: text.includes('31 小时 12 分钟'), first: play.getBoundingClientRect().top < source.getBoundingClientRect().top && play.getBoundingClientRect().top < binding.getBoundingClientRect().top, unwanted: /只读读取|来源提示|会话累计|会话记录|可能陈旧|时间范围/.test(text), dates: play.querySelectorAll('input[type="date"]').length, points: document.querySelectorAll('.recharts-line-dot').length };
  });
  if (!records.total || !records.first || records.unwanted || records.dates || records.points !== 5) throw new Error('Real records data/layout failed: ' + JSON.stringify(records));
  await screenshot('records');
  const point = await evaluate(() => { const dot = document.querySelector('.recharts-line-dot').getBoundingClientRect(); const plot = document.querySelector('.recharts-surface').getBoundingClientRect(); return { x: Math.round(dot.left + dot.width / 2), y: Math.round(plot.top + plot.height / 2) }; });
  mainWindow.webContents.sendInputEvent({ type: 'mouseMove', ...point });
  await waitFor(() => document.querySelector('.recharts-tooltip-wrapper')?.textContent.includes('5 小时 20 分钟'), 'Full 103-session aggregation failed');
  await screenshot('records-tooltip');
  await click('打开手账空间');
  await waitFor(() => Boolean(document.querySelector('.journal-workspace')), 'Journal did not open');
  // Creating a text page through IPC keeps validation, authorization and the
  // actual SQLite journal implementation in the acceptance path.
  const pageId = randomUUID();
  await mainWindow.webContents.executeJavaScript(`window.galMusic.createJournalPage({id:${JSON.stringify(pageId)},gameId:${JSON.stringify(gameId)},title:'v_1.3 真实保存验收',canvasWidth:1200,canvasHeight:900,blocks:[{id:${JSON.stringify(randomUUID())},type:'text',x:80,y:100,width:420,height:220,rotation:0,zIndex:1,locked:false,text:'待保存',color:'#f3f7f5',backgroundColor:'#20383a',fontSize:24,align:'left'}]})`);
  await click('打开作品资料');
  await click('打开手账空间');
  await waitFor(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('v_1.3 真实保存验收')), 'Created page missing');
  await evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.includes('v_1.3 真实保存验收')).click());
  await waitFor(() => Boolean(document.querySelector('textarea[aria-label="手账文字"]')), 'Real journal text editor missing');
  await evaluate(() => { const input = document.querySelector('textarea[aria-label="手账文字"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'v_1.3：真实 IPC 已保存。'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await pause();
  await evaluate(() => [...document.querySelectorAll('.journal-workspace__actions button')].find(button => button.textContent.trim() === '保存').click());
  await waitFor(() => document.querySelector('.journal-save-status')?.textContent.includes('已保存'), 'UI journal save did not finish');
  const stored = await mainWindow.webContents.executeJavaScript(`window.galMusic.getJournalPages(${JSON.stringify(gameId)})`);
  if (!stored.find(page => page.id === pageId)?.blocks.some(block => block.type === 'text' && block.text === 'v_1.3：真实 IPC 已保存。')) throw new Error('Journal UI edit did not persist through IPC');
  await screenshot('journal');
  mainWindow.setContentSize(960, 640);
  await pause();
  const narrow = await evaluate(() => {
    const sidebar = document.querySelector('.sidebar__scroll');
    const button = document.querySelector('.title-bar__import');
    const text = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    const range = document.createRange(); range.selectNodeContents(text);
    return { pageOverflow: document.documentElement.scrollWidth > innerWidth, sidebarOverflow: sidebar.scrollWidth > sidebar.clientWidth + 1, importLines: range.getClientRects().length };
  });
  if (narrow.pageOverflow || narrow.sidebarOverflow || narrow.importLines !== 1) throw new Error('Narrow real app layout failed: ' + JSON.stringify(narrow));
  await evaluate(() => document.querySelector('textarea[aria-label="手账文字"]').scrollIntoView({ block: 'center' }));
  await screenshot('narrow-journal');
  await click('打开游玩记录');
  await waitFor(() => Boolean(document.querySelector('.recharts-line-curve')), 'Narrow real chart missing');
  await evaluate(() => document.querySelector('.reina-play-chart').scrollIntoView({ block: 'center' }));
  await screenshot('narrow-records');
  await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-testid="game-item-${emptyId}"]').click()`);
  await pause();
  await waitFor(() => Boolean(document.querySelector('.game-overview')), 'Empty game overview did not open');
  await click('打开游玩记录');
  await waitFor(() => Boolean(document.querySelector('.reina-play')) && !document.querySelector('.reina-play[aria-busy="true"]'), 'Empty records did not settle');
  const empty = await evaluate(() => ({ text: document.querySelector('.reina-play').textContent, curve: Boolean(document.querySelector('.recharts-line-curve')) }));
  if (empty.curve || !empty.text.includes('0 分钟')) throw new Error('Expected zero-total empty chart: ' + JSON.stringify(empty));
  await screenshot('records-empty');
  // Read the private destination directly to substantiate the UI/IPC assertion.
  const savedDb = new Database(path.join(userData, 'galmusic.db'), { readonly: true });
  const row = savedDb.prepare('SELECT blocks_json FROM journal_pages WHERE id=?').get(pageId);
  savedDb.close();
  if (!row?.blocks_json.includes('v_1.3：真实 IPC 已保存。')) throw new Error('Private SQLite row does not contain journal edit');
  if (!fs.readFileSync(sourcePath).equals(initialSourceBytes)) throw new Error('Synthetic read-only Reina source changed');
  if (errors.length) throw new Error('Renderer errors: ' + errors.join('\n'));
  if (externalRequests.length) throw new Error('Unexpected external requests: ' + externalRequests.join(', '));
  if (mainWindow.isVisible()) throw new Error('Acceptance must keep the real app window hidden');
  console.log('UNPACKED_UI_SMOKE_OK: app.asar v1.3.0, archived main/preload/renderer, actual frozen IPC, scrolling archive, real Reina utility reader/103-session daily chart, empty chart, actual journal SQLite save, 960px layout, no network or visible window. Screenshots: ' + artifacts);
  mainWindow.destroy();
  app.quit();
}

try {
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'natsume-note-isolated-ui-acceptance', version: '1.3.0', main: 'main.cjs' }));
  fs.writeFileSync(path.join(folder, 'main.cjs'), `(${harness.toString()})().catch(error => { console.error(error); require('electron').app.exit(1); });`);
  const env = { ...process.env, NATSUME_SMOKE_ARCHIVE: archive, NATSUME_SMOKE_WORKSPACE: root, NATSUME_SMOKE_ARTIFACTS: artifacts };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(electron, [folder], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Archived UI acceptance timed out.')); }, 120_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve(code ?? 1); });
  });
} finally {
  const resolved = path.resolve(folder);
  if (!resolved.startsWith(root + path.sep) || !path.basename(resolved).startsWith('.unpacked-ui-smoke-')) throw new Error('Refusing unexpected acceptance cleanup path.');
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
