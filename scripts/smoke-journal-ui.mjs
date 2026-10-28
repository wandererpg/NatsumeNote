import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';

const root = process.cwd();
const folder = fs.mkdtempSync(path.join(root, '.journal-ui-smoke-'));
const baseline = process.argv.includes('--baseline');
const artifacts = path.join(root, 'artifacts', 'journal-ui', baseline ? 'before' : 'after');
fs.mkdirSync(artifacts, { recursive: true });
try {
  await build({ entryPoints: ['tests/smoke/journal-ui.tsx'], outfile: path.join(folder, 'ui.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic' });
  fs.writeFileSync(path.join(folder, 'index.html'), '<!doctype html><html><meta charset="UTF-8"><link rel="stylesheet" href="./ui.css"><div id="root"></div><script src="./ui.js"></script></html>');
  fs.writeFileSync(path.join(folder, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const fs = require('node:fs');
    const path = require('node:path');
    app.commandLine.appendSwitch('force-device-scale-factor', '1');
    app.setPath('userData', path.join(__dirname, 'electron-data'));
    app.whenReady().then(async () => {
      const window = new BrowserWindow({width:1440,height:960,useContentSize:true,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,offscreen:true,backgroundThrottling:false}});
      const errors=[];
      window.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
      const evaluate = (fn) => window.webContents.executeJavaScript('(' + fn.toString() + ')()');
      const screenshot = async name => { await evaluate(()=>new Promise(resolve=>{setTimeout(resolve,120);requestAnimationFrame(()=>requestAnimationFrame(resolve));})); fs.writeFileSync(path.join(${JSON.stringify(artifacts)},name+'.png'),(await window.webContents.capturePage()).toPNG()); };
      const scenarios = [['default',1440,960],['narrow',960,640],['light',1440,960],['empty',960,640],['loading',960,640],['error',960,640],['compact',960,640],['long',960,640],['crowded',1440,960],['reduced',1440,960],...['neon-terminal','amber-film','record-shop','velvet-theatre','scrapbook-diary'].map(theme=>['theme-'+theme,1440,960])];
      for (const [mode,width,height] of scenarios) {
        console.log('Journal check: '+mode);
        window.setContentSize(width,height);
        await window.loadFile(path.join(__dirname,'index.html'),{query:{mode}});
        if(!window.webContents.debugger.isAttached())window.webContents.debugger.attach('1.3');
        await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:mode==='reduced'?'reduce':'no-preference'}]});
        await new Promise(resolve=>setTimeout(resolve,550));
        const overflow=await evaluate(()=>document.documentElement.scrollWidth>innerWidth);
        if(overflow)throw new Error('Horizontal overflow: '+mode);
        const state = await evaluate(()=>({loading:document.body.textContent.includes('正在翻开手账'),error:document.body.textContent.includes('这一页暂时没有打开'),empty:Boolean(document.querySelector('.journal-canvas__empty')),theme:document.documentElement.dataset.theme,cards:document.querySelectorAll('[data-journal-block]').length}));
        if((mode==='loading'&&!state.loading)||(mode==='error'&&!state.error)||(mode==='empty'&&!state.empty)||(mode==='light'&&state.theme!=='aquarium-glass')||(mode==='crowded'&&state.cards!==40))throw new Error('Wrong fixture state: '+mode+' '+JSON.stringify(state));
        await screenshot(mode);
        if(!${baseline} && mode==='default') {
          await evaluate(()=>document.querySelector('[aria-label="便签"]').click());
          await new Promise(resolve=>setTimeout(resolve,250));
          await screenshot('selected');
          await evaluate(()=>document.querySelector('[aria-label="切换属性面板"]').click());
          await new Promise(resolve=>setTimeout(resolve,250));
          await screenshot('inspector');
          await evaluate(()=>[...document.querySelectorAll('button')].find(button=>button.textContent.includes('记忆模式')).click());
          await new Promise(resolve=>setTimeout(resolve,250));
          await screenshot('memory');
          const focused=await evaluate(()=>document.querySelector('[aria-label="记忆模式"]')?.contains(document.activeElement));
          if(!focused)throw new Error('Memory mode focus was not contained');
          await evaluate(()=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
          if(await evaluate(()=>Boolean(document.querySelector('[aria-label="记忆模式"]'))))throw new Error('Escape did not close memory mode');
        }
        if(!${baseline} && ['narrow','compact','long'].includes(mode)) {
      const editZoom = await evaluate(()=>parseInt(document.querySelector('[aria-label="画布缩放"]').textContent,10));
      if(editZoom<75)throw new Error('Editing text too small: '+mode+' '+editZoom);
      await evaluate(()=>document.querySelector('[aria-label="适应窗口"]').click());
      await new Promise(resolve=>setTimeout(resolve,100));
      const paperFits = await evaluate(()=>{const viewport=document.querySelector('.journal-canvas-viewport');const paper=document.querySelector('.journal-canvas-sizer').getBoundingClientRect();return paper.width<=viewport.clientWidth&&paper.height<=viewport.clientHeight;});
      if(!paperFits)throw new Error('Whole-paper fit failed: '+mode);
      await screenshot(mode+'-fit');
      const footerVisible = await evaluate(()=>document.querySelector('.journal-workspace__bottomline').getBoundingClientRect().bottom <= innerHeight);
          if(!footerVisible) throw new Error('Footer outside the minimum window: '+mode);
          await evaluate(()=>document.querySelector('[aria-label="切换属性面板"]').click());
          await new Promise(resolve=>setTimeout(resolve,200));
          const closeVisible=await evaluate(()=>{const rect=document.querySelector('[aria-label="关闭属性面板"]').getBoundingClientRect();return rect.right<=innerWidth&&rect.top>=0;});
          if(!closeVisible)throw new Error('Inspector cannot be closed: '+mode);
          await screenshot(mode+'-inspector');
        }
        if(!${baseline} && mode==='reduced') {
          await evaluate(()=>{document.querySelector('[aria-label="便签"]').click();document.querySelector('[aria-label="切换属性面板"]').click();});
          await new Promise(resolve=>setTimeout(resolve,40));
          const motion = await evaluate(()=>({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,stage:document.querySelector('.journal-canvas-stage').style.transform,panel:document.querySelector('.journal-inspector').style.transform}));
          if(!motion.reduced||motion.stage||motion.panel)throw new Error('Reduced motion was not respected: '+JSON.stringify(motion));
        }
      }
      if(errors.length)throw new Error(errors.join('\\n'));
      console.log('JOURNAL_UI_SMOKE_OK: '+scenarios.length+' layouts/states across seven themes; fit, selection, inspector, memory focus, Escape and reduced motion verified. Screenshots: '+${JSON.stringify(artifacts)});
      window.destroy();app.exit(0);
    }).catch(error=>{console.error(error);app.exit(1);});
  `);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(folder, 'main.cjs')], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Journal UI smoke timed out.')); }, 45000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve(code ?? 1); });
  });
} finally {
  const resolved = path.resolve(folder);
  if (!resolved.startsWith(root + path.sep) || !path.basename(resolved).startsWith('.journal-ui-smoke-')) throw new Error('Refusing unexpected cleanup path.');
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
