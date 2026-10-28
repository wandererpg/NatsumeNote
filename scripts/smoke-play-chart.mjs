import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';

const root = process.cwd();
const folder = fs.mkdtempSync(path.join(root, '.play-chart-smoke-'));
const artifacts = path.join(root, 'artifacts', 'play-chart-ui');
fs.mkdirSync(artifacts, { recursive: true });
try {
  await build({ entryPoints: ['tests/smoke/play-chart.tsx'], outfile: path.join(folder, 'ui.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic' });
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
      const scenarios = [['default',1440,960],['narrow',960,640],['light',1440,960],['single',1440,960],['empty',1440,960],['long',1440,960]];
      for (const [mode,width,height] of scenarios) {
        console.log('Play chart check: '+mode);
        window.setContentSize(width,height);
        await window.loadFile(path.join(__dirname,'index.html'),{query:{mode}});
        let ready = false;
        for(let attempt=0; attempt<35; attempt++) {
          await settle();
          ready = await evaluate(()=>Boolean(document.querySelector('.reina-play-chart')) && !document.querySelector('.reina-play[aria-busy="true"]'));
          if(ready) break;
        }
        if(!ready) throw new Error('Play chart did not settle: '+mode+' '+await evaluate(()=>document.body.textContent));
        const state = await evaluate(()=>{
          const play = document.querySelector('.reina-play');
          const chart = document.querySelector('.reina-play-chart');
          const source = document.querySelector('[aria-labelledby="reina-source-title"]');
          const binding = document.querySelector('[aria-labelledby="reina-binding-title"]');
          const body = document.body.textContent;
          const banned = ['只读读取', '半开区间', '跨午夜的记录不会', '来源提示', '时长来自来源保存', '只包含已保存的会话', '来源未保存计时方式', '会话记录', '可能陈旧', '会话累计', '时间范围'];
          const curves = chart.querySelectorAll('.recharts-line-curve').length;
          const dots = chart.querySelectorAll('.recharts-line-dot').length;
          return {
            overflow: document.documentElement.scrollWidth>innerWidth,
            contentOverflow: chart.scrollWidth>chart.clientWidth+1,
            playFirst: play.getBoundingClientRect().top < source.getBoundingClientRect().top && play.getBoundingClientRect().top < binding.getBoundingClientRect().top,
            forbidden: banned.filter(text=>body.includes(text)),
            dateInputs: document.querySelectorAll('input[type="date"]').length,
            sourceTotal: body.includes('来源总计'),
            curves, dots,
            calls: window.__playSmoke.queries,
            theme: document.documentElement.dataset.theme,
          };
        });
        if(state.overflow||state.contentOverflow||!state.playFirst||state.forbidden.length||state.dateInputs||!state.sourceTotal||(mode!=='empty'&&!state.dots)||(mode!=='empty'&&mode!=='single'&&!state.curves)||(mode==='light'&&state.theme!=='aquarium-glass')) {
          throw new Error('Play chart layout/state failed: '+mode+' '+JSON.stringify(state));
        }
        const sessionCalls = state.calls.filter(call=>call.tool==='reina_list_sessions');
        const expectsTwoPages = !['single','empty','long'].includes(mode);
        if(sessionCalls.length !== (expectsTwoPages ? 2 : 1) || sessionCalls.some(call=>call.input.limit!==100||call.input.snapshotId!=='play-smoke-snapshot'||call.input.from||call.input.to) || (expectsTwoPages && sessionCalls[1].input.cursor!=='page-2')) {
          throw new Error('Complete history pagination failed: '+mode+' '+JSON.stringify(sessionCalls));
        }
        await screenshot(mode);
        if(mode==='default') {
          const bounds = await evaluate(()=>{
            const surface=document.querySelector('.reina-play-chart .recharts-surface');
            surface.focus();
            const box=surface.getBoundingClientRect();
            return {x:box.left+box.width/2,y:box.top+box.height/2, points:[...document.querySelectorAll('.reina-play-chart .recharts-line-dot')].map(point=>{const dot=point.getBoundingClientRect();return {x:dot.left+dot.width/2,y:box.top+box.height/2};})};
          });
          window.webContents.sendInputEvent({type:'keyDown',keyCode:'ArrowRight'});
          window.webContents.sendInputEvent({type:'keyUp',keyCode:'ArrowRight'});
          await settle();
          let tooltip = await evaluate(()=>document.querySelector('.recharts-tooltip-wrapper')?.textContent??'');
          if(!tooltip.trim()) {
            window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(bounds.x),y:Math.round(bounds.y)});
            await settle();
            tooltip = await evaluate(()=>document.querySelector('.recharts-tooltip-wrapper')?.textContent??'');
          }
          if(!tooltip.trim()) throw new Error('Chart tooltip did not respond to keyboard or pointer');
          await screenshot('default-tooltip');
          console.log('Chart interaction: '+tooltip.trim());
          for(const [index,expected] of [[0,'17 小时'],[1,'0 分钟'],[2,'1 小时']]) {
            const point=bounds.points[index];
            window.webContents.sendInputEvent({type:'mouseMove',x:Math.round(point.x),y:Math.round(point.y)});
            await settle();
            const text=await evaluate(()=>document.querySelector('.recharts-tooltip-wrapper')?.textContent??'');
            if(!text.includes(expected)) throw new Error('Daily duration aggregation failed at point '+index+': '+text+' (expected '+expected+')');
          }
        }
      }
      if(errors.length) throw new Error(errors.join('\\n'));
      console.log('PLAY_CHART_SMOKE_OK: 6 layouts; full history, compact totals, chart interaction, clean prose and controls below history verified. Screenshots: '+${JSON.stringify(artifacts)});
      window.destroy(); app.exit(0);
    }).catch(error=>{console.error(error);app.exit(1);});
  `);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(folder, 'main.cjs')], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Play chart smoke timed out.')); }, 45000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve(code ?? 1); });
  });
} finally {
  const resolved = path.resolve(folder);
  if (!resolved.startsWith(root + path.sep) || !path.basename(resolved).startsWith('.play-chart-smoke-')) throw new Error('Refusing unexpected cleanup path.');
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
