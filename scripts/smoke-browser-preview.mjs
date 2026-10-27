import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';

const root = process.cwd();
const folder = fs.mkdtempSync(path.join(root, '.browser-preview-smoke-'));
const artifacts = path.join(root, 'artifacts', 'browser-preview-ui');
const port = 5183;
const address = `http://127.0.0.1:${port}/`;
const config = path.join(root, 'vite.web.config.ts');
let vite;
let viteOutput = '';
fs.mkdirSync(artifacts, { recursive: true });

try {
  if (!fs.existsSync(config)) throw new Error('Browser Vite config is not available yet.');
  vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', config, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  vite.stdout.on('data', value => { viteOutput += value; });
  vite.stderr.on('data', value => { viteOutput += value; });
  let started = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (vite.exitCode !== null) throw new Error('Vite exited before starting: ' + viteOutput);
    try { if ((await fetch(address)).ok) { started = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!started) throw new Error('Browser preview server did not start: ' + viteOutput);

  fs.writeFileSync(path.join(folder, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const fs = require('node:fs');
    const path = require('node:path');
    app.commandLine.appendSwitch('force-device-scale-factor', '1');
    app.setPath('userData', path.join(__dirname, 'electron-data'));
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ width:1440, height:960, useContentSize:true, show:false, webPreferences:{ contextIsolation:true, nodeIntegration:false, sandbox:true, offscreen:true, backgroundThrottling:false } });
      const errors = [];
      window.webContents.on('console-message', (_event, level, message) => { if(level===3) errors.push(message); });
      const evaluate = fn => window.webContents.executeJavaScript('(' + fn.toString() + ')()');
      const settle = () => new Promise(resolve => setTimeout(resolve, 160));
      const waitFor = async (fn, label) => {
        for(let attempt=0; attempt<100; attempt++) { if(await evaluate(fn)) return; await settle(); }
        throw new Error(label+': '+await evaluate(()=>document.body.textContent));
      };
      const screenshot = async name => {
        await settle();
        fs.writeFileSync(path.join(${JSON.stringify(artifacts)}, name+'.png'), (await window.webContents.capturePage()).toPNG());
      };
      const click = async label => {
        const clicked = await window.webContents.executeJavaScript('(() => { const node = document.querySelector('+JSON.stringify('[aria-label="'+label+'"]')+'); if(!node || node.disabled) return false; node.click(); return true; })()');
        if(!clicked) throw new Error('Control unavailable: '+label);
        await settle();
      };
      const openGame = async () => {
        await waitFor(()=>Boolean(document.querySelector('[data-testid="game-item-preview-amatsutsumi"]')) || Boolean(document.querySelector('.game-room')), 'Demo library did not load');
        await evaluate(()=>document.querySelector('[data-testid="game-item-preview-amatsutsumi"]')?.click());
        await waitFor(()=>Boolean(document.querySelector('.game-overview')), 'Game overview did not open');
      };

      await window.loadURL(${JSON.stringify(address)});
      await waitFor(()=>document.body.textContent.includes('v_1.3'), 'Version badge missing');
      await screenshot('library');
      await openGame();
      await waitFor(()=>document.querySelectorAll('.staff-list li').length===40, 'Complete staff data missing');
      const overview = await evaluate(()=>{
        const summary=document.querySelector('.summary-reader__scroll');
        const staff=document.querySelector('.staff-list');
        const main=document.querySelector('.game-overview__main');
        const rail=document.querySelector('.game-overview__facts');
        const tags=document.querySelector('.game-overview__tags');
        return {
          summaryScroll:summary.scrollHeight>summary.clientHeight,
          summaryHeight:[summary.clientHeight,summary.scrollHeight],
          summaryTextLength:summary.textContent.length,
          staffScroll:staff.scrollHeight>staff.clientHeight,
          tagsRight:rail.contains(tags)&&rail.getBoundingClientRect().left>=main.getBoundingClientRect().right-1,
          sourceMarkup:document.body.textContent.includes('[From')||document.body.textContent.includes('[url='),
          overflow:document.documentElement.scrollWidth>innerWidth,
        };
      });
      await screenshot('overview');
      if(!overview.summaryScroll||!overview.staffScroll||!overview.tagsRight||overview.sourceMarkup||overview.overflow) throw new Error('Archive layout failed: '+JSON.stringify(overview));
      await evaluate(()=>{
        window.__previewQueries=[];
        const query=window.galMusic.reinaQuery.bind(window.galMusic);
        window.galMusic.reinaQuery=async (tool,input)=>{window.__previewQueries.push({tool,input});return query(tool,input);};
      });
      await click('打开游玩记录');
      await waitFor(()=>Boolean(document.querySelector('.recharts-line-curve'))&&!document.querySelector('.reina-play[aria-busy="true"]'), 'Daily chart did not load');
      const records=await evaluate(()=>{
        const play=document.querySelector('.reina-play');
        const source=document.querySelector('[aria-labelledby="reina-source-title"]');
        const binding=document.querySelector('[aria-labelledby="reina-binding-title"]');
        const text=document.querySelector('.game-records').textContent;
        return {
          total:text.includes('31 小时 12 分钟'),
          first:play.getBoundingClientRect().top<source.getBoundingClientRect().top&&play.getBoundingClientRect().top<binding.getBoundingClientRect().top,
          unwanted:/只读读取|来源提示|会话累计|会话记录|可能陈旧|时间范围/.test(text),
          dates:play.querySelectorAll('input[type="date"]').length,
          queries:window.__previewQueries.filter(call=>call.tool==='reina_list_sessions'),
        };
      });
      if(!records.total||!records.first||records.unwanted||records.dates||records.queries.length!==2||records.queries.some(call=>call.input.snapshotId!=='preview-snapshot-42'||call.input.limit!==100)||records.queries[1].input.cursor!=='offset:100') throw new Error('Records data/layout failed: '+JSON.stringify(records));
      await screenshot('records');
      const point=await evaluate(()=>{const dot=document.querySelector('.recharts-line-dot');const plot=document.querySelector('.recharts-surface');const d=dot.getBoundingClientRect();const p=plot.getBoundingClientRect();return {x:d.left+d.width/2,y:p.top+p.height/2};});
      window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(point.x),y:Math.round(point.y)});
      await waitFor(()=>document.querySelector('.recharts-tooltip-wrapper')?.textContent.includes('5 小时 20 分钟'), 'Complete daily aggregation tooltip failed');
      await screenshot('records-tooltip');
      await click('打开手账空间');
      await waitFor(()=>Boolean(document.querySelector('textarea[aria-label="手账文字"]')), 'Journal did not load');
      await evaluate(()=>{
        const input=document.querySelector('textarea[aria-label="手账文字"]');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Vite v_1.3：已验证编辑与保存。');
        input.dispatchEvent(new Event('input',{bubbles:true}));
      });
      await settle();
      await evaluate(()=>[...document.querySelectorAll('.journal-workspace__actions button')].find(button=>button.textContent.trim()==='保存').click());
      await waitFor(()=>document.querySelector('.journal-save-status')?.textContent.includes('已保存'), 'Journal did not save');
      await screenshot('journal');
      await click('设置');
      await waitFor(()=>Boolean(document.querySelector('[data-card-theme="aquarium-glass"] input')), 'Theme controls missing');
      await evaluate(()=>document.querySelector('[data-card-theme="aquarium-glass"] input').click());
      await waitFor(()=>document.querySelector('[data-testid="app-shell"]')?.dataset.theme==='aquarium-glass', 'Light theme did not apply');
      await evaluate(()=>[...document.querySelectorAll('.settings-panel__footer button')].find(button=>button.textContent.includes('保存设置')).click());
      await waitFor(()=>!document.querySelector('.settings-panel'), 'Settings did not save');
      await screenshot('light-journal');
      await window.loadURL(${JSON.stringify(address)});
      await waitFor(()=>document.querySelector('[data-testid="app-shell"]')?.dataset.theme==='aquarium-glass', 'Theme did not persist across refresh');
      await openGame();
      await click('打开手账空间');
      await waitFor(()=>document.querySelector('textarea[aria-label="手账文字"]')?.value==='Vite v_1.3：已验证编辑与保存。', 'Journal edit did not persist across refresh');
      window.setContentSize(960,640);
      await settle();
      const narrowShell = await evaluate(()=>{
        const scroll=document.querySelector('.sidebar__scroll');
        const bounds=scroll.getBoundingClientRect();
        const button=document.querySelector('.title-bar__import');
        const text=[...button.childNodes].find(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim());
        const range=document.createRange();range.selectNodeContents(text);
        return {
          sidebar:{clientWidth:scroll.clientWidth,scrollWidth:scroll.scrollWidth},
          overflowing:[...scroll.querySelectorAll('*')].map(node=>{
            const rect=node.getBoundingClientRect();
            return {tag:node.tagName,class:typeof node.className==='string'?node.className:'',width:rect.width,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,left:rect.left,right:rect.right};
          }).filter(node=>node.right>bounds.left+scroll.clientWidth+1||node.scrollWidth>node.clientWidth+1),
          import:{height:button.getBoundingClientRect().height,textLines:range.getClientRects().length,whiteSpace:getComputedStyle(button).whiteSpace},
        };
      });
      if(narrowShell.sidebar.scrollWidth>narrowShell.sidebar.clientWidth+1||narrowShell.import.height>40||narrowShell.import.textLines!==1) throw new Error('Narrow shell layout failed: '+JSON.stringify(narrowShell));
      const narrowJournal=await evaluate(()=>document.documentElement.scrollWidth>innerWidth);
      if(narrowJournal) throw new Error('Narrow journal overflows window');
      await evaluate(()=>document.querySelector('textarea[aria-label="手账文字"]').scrollIntoView({block:'center'}));
      await screenshot('narrow-journal');
      await click('打开游玩记录');
      await waitFor(()=>Boolean(document.querySelector('.recharts-line-curve')), 'Narrow records did not load');
      const narrow=await evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,chartOverflow:document.querySelector('.reina-play-chart').scrollWidth>document.querySelector('.reina-play-chart').clientWidth+1}));
      if(narrow.overflow||narrow.chartOverflow) throw new Error('Narrow records overflow: '+JSON.stringify(narrow));
      await evaluate(()=>document.querySelector('.reina-play-chart').scrollIntoView({block:'center'}));
      await screenshot('narrow-records');
      if(errors.length) throw new Error(errors.join('\\n'));
      console.log('BROWSER_PREVIEW_SMOKE_OK: real Vite app, v_1.3, archive scrolling/right tags, full daily history, journal editing and persistence, light theme persistence and 960x640 layouts. Screenshots: '+${JSON.stringify(artifacts)});
      window.destroy(); app.exit(0);
    }).catch(error=>{console.error(error);app.exit(1);});
  `);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(folder, 'main.cjs')], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Browser preview smoke timed out.')); }, 90_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve(code ?? 1); });
  });
} finally {
  if (vite && vite.exitCode === null) {
    vite.kill();
    await new Promise(resolve => { vite.once('exit', resolve); setTimeout(resolve, 3000); });
  }
  const resolved = path.resolve(folder);
  if (!resolved.startsWith(root + path.sep) || !path.basename(resolved).startsWith('.browser-preview-smoke-')) throw new Error('Refusing unexpected preview cleanup path.');
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
