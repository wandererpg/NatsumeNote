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
      const scenarios = [['default',1440,960],['right-long',1440,960],['narrow',960,640],['light',1440,960],['bilingual',1440,960],['short',1440,960],['six-characters',1440,960],['six-narrow',960,640],['staff-only',1440,960],['characters-only',1440,960],['stacked',760,900],['long-title',1440,960]];
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
          const overview=document.querySelector('.game-overview');
          const cover=document.querySelector('.game-overview__cover');
          const main=document.querySelector('.game-overview__main');
          const facts=document.querySelector('.game-overview__facts');
          const details=document.querySelector('.game-archive-details');
          const characters=document.querySelector('.game-archive-details__characters');
          const team=document.querySelector('.game-archive-details__staff');
          const tags=document.querySelector('[role="group"][aria-label="作品标签"]');
          const summary=document.querySelector('.summary-reader__scroll');
          const edit=document.querySelector('.game-overview__main > .button');
          const staff=document.querySelector('.staff-list');
          const body=document.body.textContent;
          const imageProbe=document.createElement('img');
          imageProbe.style.display='none';
          cover.append(imageProbe);
          const coverObjectFit=getComputedStyle(imageProbe).objectFit;
          imageProbe.remove();
          const bounds=element=>{
            if(!element)return null;
            const {top,bottom,left,right,height,width}=element.getBoundingClientRect();
            return {top,bottom,left,right,height,width};
          };
          const columns=getComputedStyle(overview).gridTemplateColumns.split(' ').length;
          return {
            overflow: document.documentElement.scrollWidth>innerWidth,
            tagsRight: facts.contains(tags)&&facts.getBoundingClientRect().left>=main.getBoundingClientRect().right-1,
            summaryScrollable: summary.scrollHeight>summary.clientHeight,
            staffScrollable: staff?staff.scrollHeight>staff.clientHeight:false,
            staffCount: staff?staff.querySelectorAll('li').length:0,
            characterCount: document.querySelectorAll('.character-card').length,
            oldNotice: body.includes('资料暂时加载失败')||body.includes('已导入的作品和游玩记录仍可使用'),
            sourceMarkup: body.includes('[From')||body.includes('[url=')||body.includes('Sekai Project'),
            records: body.includes('已保存的游玩记录'),
            languageBlocks: summary.querySelectorAll('.summary-reader__text').length,
            theme: document.documentElement.dataset.theme,
            columns, coverObjectFit,cover:bounds(cover),main:bounds(main),facts:bounds(facts),summary:bounds(summary),edit:bounds(edit),details:bounds(details),characters:bounds(characters),team:bounds(team),staff:bounds(staff),
          };
        });
        const hasStaff=mode!=='characters-only';
        const hasCharacters=mode!=='staff-only';
        const scrollSummary=mode!=='short';
        const aligned=rectangles=>Math.max(...rectangles.map(rect=>rect.top))-Math.min(...rectangles.map(rect=>rect.top))<=2&&Math.max(...rectangles.map(rect=>rect.bottom))-Math.min(...rectangles.map(rect=>rect.bottom))<=2;
        if(state.overflow||!state.tagsRight||state.summaryScrollable!==scrollSummary||state.staffScrollable!==hasStaff||state.staffCount!==(hasStaff?40:0)||state.oldNotice||state.sourceMarkup||state.records||(mode==='bilingual'&&state.languageBlocks!==2)||(mode==='light'&&state.theme!=='aquarium-glass')) {
          throw new Error('Overview layout/state failed: '+mode+' '+JSON.stringify(state));
        }
        if(width>800&&(state.columns!==3||!aligned([state.main,state.facts]))) throw new Error('Overview text columns are not aligned: '+mode+' '+JSON.stringify(state));
        if(Math.abs(state.cover.width/state.cover.height-.72)>.01||state.coverObjectFit!=='cover') throw new Error('Original poster proportions or fit changed: '+mode+' '+JSON.stringify(state));
        if(width>800&&Math.abs(state.edit.top-state.summary.bottom-24)>2) throw new Error('Synopsis must fill space up to the normal edit-button gap: '+mode+' '+JSON.stringify(state));
        if(['default','right-long'].includes(mode)&&state.summary.height<=248) throw new Error('Synopsis did not grow beyond its former 248px cap: '+mode+' '+JSON.stringify(state));
        if(hasCharacters&&hasStaff&&width>800&&(!aligned([state.characters,state.team])||Math.abs(state.staff.bottom-state.characters.bottom)>2)) throw new Error('Character/team columns are not aligned: '+mode+' '+JSON.stringify(state));
        if(hasStaff&&(state.team.height<100||state.staff.height<70)) throw new Error('Team column collapsed: '+mode+' '+JSON.stringify(state));
        if(hasCharacters&&hasStaff&&width<=800&&state.team.top<state.characters.bottom-2) throw new Error('Narrow team must follow characters: '+JSON.stringify(state));
        if(!hasCharacters||!hasStaff) {
          const only=state.characters||state.team;
          if(Math.abs(only.left-state.details.left)>2||Math.abs(only.right-state.details.right)>2) throw new Error('Single detail column must fill available width: '+mode+' '+JSON.stringify(state));
        }
        if(['six-characters','six-narrow','stacked','long-title'].includes(mode)&&state.characterCount!==6) throw new Error('Six-character fixture missing');
        await screenshot(mode);
        const scroll = await evaluate(()=>{
          const summary=document.querySelector('.summary-reader__scroll');
          const staff=document.querySelector('.staff-list');
          summary.scrollTop=summary.scrollHeight;
          if(staff)staff.scrollTop=staff.scrollHeight;
          const last=staff?.lastElementChild.getBoundingClientRect();
          const bounds=staff?.getBoundingClientRect();
          return { summary:summary.scrollTop, staff:staff?.scrollTop??0, lastVisible:!staff||(last.top>=bounds.top-1&&last.bottom<=bounds.bottom+1) };
        });
        if((scrollSummary&&scroll.summary<=0)||(hasStaff&&scroll.staff<=0)||!scroll.lastVisible) throw new Error('Inner scrolling failed: '+mode+' '+JSON.stringify(scroll));
        await evaluate(()=>document.querySelector('.game-archive-details').scrollIntoView({block:'end'}));
        await screenshot(mode+'-scrolled');
      }
      if(errors.length) throw new Error(errors.join('\\n'));
      console.log('GAME_OVERVIEW_SMOKE_OK: 12 layouts; original poster proportions/fit, aligned text columns with synopsis filling the former blank space, adaptive 6-character/team height at wide/narrow widths, short summary, staff-only/characters-only, 760px stacking, long titles, scrolling of all 40 staff, right tags and bilingual view verified. Screenshots: '+${JSON.stringify(artifacts)});
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
