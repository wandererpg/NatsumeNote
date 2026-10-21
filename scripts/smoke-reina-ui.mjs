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
      for (const mode of ['connected','empty','loading','error']) {
        await window.loadFile(path.join(__dirname,'index.html'), {query:{mode},hash:mode});
        await new Promise(resolve => setTimeout(resolve,650));
        const result = await window.webContents.executeJavaScript("({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,text:document.body.innerText,buttons:document.querySelectorAll('button').length})");
        if(result.width!==960 || result.overflow || result.buttons===0) throw new Error('UI layout failed: '+mode+' '+JSON.stringify(result));
        const expected = {connected:'来源累计',empty:'连接',loading:'读取',error:'无法读取数据库'}[mode];
        if(!result.text.includes(expected)) throw new Error('UI state missing: '+mode+' '+result.text);
        await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(${JSON.stringify(artifacts)},mode+'.png'),(await window.webContents.capturePage()).toPNG());
        if(mode==='connected') {
          await window.webContents.executeJavaScript("document.getElementById('root').scrollTop=document.getElementById('root').scrollHeight;new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
          fs.writeFileSync(path.join(${JSON.stringify(artifacts)},'connected-sessions.png'),(await window.webContents.capturePage()).toPNG());
        }
      }
      window.destroy(); console.log('REINA_UI_SMOKE_OK: four 960x640 states, no horizontal overflow; screenshots in artifacts/reina-ui.'); app.exit(0);
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
