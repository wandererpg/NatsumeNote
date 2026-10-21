import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';

const root = process.cwd();
const folder = fs.mkdtempSync(path.join(root, '.reina-ui-smoke-'));
const artifacts = path.join(root, 'artifacts', 'reina-ui');
fs.mkdirSync(artifacts, { recursive: true });
try {
  await build({ entryPoints: ['tests/smoke/reina-ui.tsx'], outfile: path.join(folder, 'ui.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic' });
  fs.writeFileSync(path.join(folder, 'index.html'), '<!doctype html><meta charset="UTF-8"><link rel="stylesheet" href="./ui.css"><div id="root" style="height:100vh;overflow:auto"></div><script src="./ui.js"></script>');
  fs.writeFileSync(path.join(folder, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const fs = require('node:fs');
    const path = require('node:path');
    app.commandLine.appendSwitch('force-device-scale-factor','1');
    app.setPath('userData', path.join(__dirname, 'electron-data'));
    app.whenReady().then(async () => {
      const window = new BrowserWindow({width:960,height:640,useContentSize:true,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,offscreen:true,backgroundThrottling:false}});
  for (const mode of ['connected','empty','loading','error','browse','batch','batch-loading','batch-error']) {
        await window.loadFile(path.join(__dirname,'index.html'), {query:{mode},hash:mode});
        await new Promise(resolve => setTimeout(resolve,650));
        if (mode === 'browse') {
          await window.webContents.executeJavaScript(
            "(async () => { const wait = async (find) => { for(let i=0;i<100;i++){ const found=find(); if(found)return found; await new Promise(r=>setTimeout(r,20)); } throw new Error('Browse UI timeout'); }; const browse=await wait(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('浏览全部来源作品'))); browse.click(); const candidate=await wait(()=>document.querySelector('[role=radio]')); candidate.click(); const preview=await wait(()=>{const p=document.querySelector('[aria-label=历史时长预览]');return p?.textContent.includes('1 小时 39 分钟')?p:null;}); preview.scrollIntoView({block:'center'}); })()"
          );
        }
    if (mode.startsWith('batch')) {
      await window.webContents.executeJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('预览并导入全部作品')).click()");
      await new Promise(resolve => setTimeout(resolve, 150));
      await window.webContents.executeJavaScript("document.querySelector('.reina-batch').scrollIntoView({block:'start'})");
    }
    const result = await window.webContents.executeJavaScript("({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,text:document.body.innerText,buttons:document.querySelectorAll('button').length})");
        if(result.width!==960 || result.overflow || result.buttons===0) throw new Error('UI layout failed: '+mode+' '+JSON.stringify(result));
    const expected = {connected:'来源累计',empty:'连接',loading:'读取',error:'无法读取数据库',browse:'历史时长预览',batch:'共 28 部','batch-loading':'正在读取全部作品','batch-error':'无法读取批量导入预览'}[mode];
        if(!result.text.includes(expected)) throw new Error('UI state missing: '+mode+' '+result.text);
        await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(${JSON.stringify(artifacts)},mode+'.png'),(await window.webContents.capturePage()).toPNG());
        if(mode==='connected') {
          await window.webContents.executeJavaScript("document.getElementById('root').scrollTop=document.getElementById('root').scrollHeight;new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
          fs.writeFileSync(path.join(${JSON.stringify(artifacts)},'connected-sessions.png'),(await window.webContents.capturePage()).toPNG());
        }
      }
      window.destroy(); console.log('REINA_UI_SMOKE_OK: eight 960x640 states including batch import, no horizontal overflow; screenshots in artifacts/reina-ui.'); app.exit(0);
    }).catch(error=>{console.error(error);app.exit(1);});
  `);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(folder, 'main.cjs')], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    const timer = setTimeout(() => { child.kill(); reject(new Error('UI smoke timed out.')); }, 30000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve(code ?? 1); });
  });
} finally {
  const resolved = path.resolve(folder);
  if (!resolved.startsWith(root + path.sep) || !path.basename(resolved).startsWith('.reina-ui-smoke-')) throw new Error('Refusing unexpected cleanup path.');
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
