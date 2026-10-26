import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';

const root = process.cwd();
const folder = fs.mkdtempSync(path.join(root, '.game-overview-smoke-'));
const artifacts = path.join(root, 'artifacts', 'game-overview-ui');
fs.mkdirSync(artifacts, { recursive: true });
try {
  await build({ entryPoints: ['tests/smoke/game-overview.tsx'], outfile: path.join(folder, 'ui.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic' });
  fs.writeFileSync(path.join(folder, 'index.html'), '<!doctype html><html><meta charset="UTF-8"><link rel="stylesheet" href="./ui.css"><div id="root"></div><script src="./ui.js"></script></html>');
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
      const settle = () => new Promise(resolve => setTimeout(resolve, 180));
      const screenshot = async name => {
        await settle();
        fs.writeFileSync(path.join(${JSON.stringify(artifacts)}, name+'.png'), (await window.webContents.capturePage()).toPNG());
      };
      const scenarios = [['default',1440,960],['narrow',960,640],['light',1440,960],['bilingual',1440,960]];
      for (const [mode,width,height] of scenarios) {
        console.log('Overview check: '+mode);
        window.setContentSize(width,height);
        await window.loadFile(path.join(__dirname,'index.html'),{query:{mode}});
        await settle();
        if(mode==='bilingual') {
          await evaluate(()=>document.querySelector('[aria-label="中文与原文双语对照"]').click());
          await settle();
        }
        const state = await evaluate(()=>{
          const main=document.querySelector('.game-overview__main');
          const facts=document.querySelector('.game-overview__facts');
          const tags=document.querySelector('[role="group"][aria-label="作品标签"]');
          const summary=document.querySelector('.summary-reader__scroll');
          const staff=document.querySelector('.staff-list');
          const body=document.body.textContent;
          return {
            overflow: document.documentElement.scrollWidth>innerWidth,
            tagsRight: facts.contains(tags)&&facts.getBoundingClientRect().left>=main.getBoundingClientRect().right-1,
            summaryScrollable: summary.scrollHeight>summary.clientHeight,
            staffScrollable: staff.scrollHeight>staff.clientHeight,
            staffCount: staff.querySelectorAll('li').length,
            oldNotice: body.includes('资料暂时加载失败')||body.includes('已导入的作品和游玩记录仍可使用'),
            sourceMarkup: body.includes('[From')||body.includes('[url=')||body.includes('Sekai Project'),
            records: body.includes('已保存的游玩记录'),
            languageBlocks: summary.querySelectorAll('.summary-reader__text').length,
            theme: document.documentElement.dataset.theme,
          };
        });
        if(state.overflow||!state.tagsRight||!state.summaryScrollable||!state.staffScrollable||state.staffCount!==40||state.oldNotice||state.sourceMarkup||state.records||(mode==='bilingual'&&state.languageBlocks!==2)||(mode==='light'&&state.theme!=='aquarium-glass')) {
          throw new Error('Overview layout/state failed: '+mode+' '+JSON.stringify(state));
        }
        await screenshot(mode);
        const scroll = await evaluate(()=>{
          const summary=document.querySelector('.summary-reader__scroll');
          const staff=document.querySelector('.staff-list');
          summary.scrollTop=summary.scrollHeight;
          staff.scrollTop=staff.scrollHeight;
          const last=staff.lastElementChild.getBoundingClientRect();
          const bounds=staff.getBoundingClientRect();
          return { summary:summary.scrollTop, staff:staff.scrollTop, lastVisible:last.top>=bounds.top-1&&last.bottom<=bounds.bottom+1 };
        });
        if(scroll.summary<=0||scroll.staff<=0||!scroll.lastVisible) throw new Error('Inner scrolling failed: '+mode+' '+JSON.stringify(scroll));
        await evaluate(()=>document.querySelector('.game-archive-details').scrollIntoView({block:'end'}));
        await screenshot(mode+'-scrolled');
      }
      if(errors.length) throw new Error(errors.join('\\n'));
      console.log('GAME_OVERVIEW_SMOKE_OK: 4 layouts; readable bounded summary/staff scrolling, all 40 staff, right tags, clean prose, separate records and bilingual view verified. Screenshots: '+${JSON.stringify(artifacts)});
      window.destroy(); app.exit(0);
    }).catch(error=>{console.error(error);app.exit(1);});
  `);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(folder, 'main.cjs')], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Game overview smoke timed out.')); }, 45000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve(code ?? 1); });
  });
} finally {
  const resolved = path.resolve(folder);
  if (!resolved.startsWith(root + path.sep) || !path.basename(resolved).startsWith('.game-overview-smoke-')) throw new Error('Refusing unexpected cleanup path.');
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
