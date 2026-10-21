import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';
const root = process.cwd();
const packaged = process.argv[2] ? path.resolve(process.argv[2], 'win-unpacked') : null;
const worker = packaged ? path.join(packaged, 'resources/app.asar/out/main/reina-query.js') : path.join(root, 'out/main/reina-query.js');
if (!packaged && !fs.existsSync(worker)) throw new Error('Run npm run build before the Reina smoke check.');
const folder = fs.mkdtempSync(path.join(root,'.reina-smoke-'));
try {
  const entry = path.join(folder,'main.cjs');
  await build({entryPoints:['tests/smoke/reina-main.ts'],outfile:entry,bundle:true,platform:'node',target:'node20',format:'cjs',packages:'external', plugins: packaged ? [{name:'packaged-sqlite', setup(builder) {builder.onResolve({filter:/^better-sqlite3$/}, () => ({path:path.join(packaged,'resources/app.asar/node_modules/better-sqlite3'),external:true}));}}] : []});
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  env.REINA_SMOKE_WORKER = worker;
 let runtime = electron;
 if (packaged) {
   // Private runtime entry point; worker and SQLite load from the release ASAR.
   const runtimeDir = path.join(folder,'runtime');
   fs.mkdirSync(runtimeDir);
   for (const item of fs.readdirSync(packaged)) {
     if (item !== 'resources') fs.cpSync(path.join(packaged,item),path.join(runtimeDir,item),{recursive:true});
   }
   const appDir = path.join(runtimeDir,'resources/app');
   fs.mkdirSync(appDir,{recursive:true});
   fs.writeFileSync(path.join(appDir,'package.json'),JSON.stringify({name:'reina-release-smoke',version:'1.0.0',main:'../../../main.cjs'}));
   runtime = path.join(runtimeDir,'NatsumeNote.exe');
 }
 const code = await new Promise((resolve,reject)=>{
    const child = spawn(runtime,[entry,`--reina-smoke-dir=${folder}`],{cwd:root,env,stdio:'inherit',windowsHide:true});
    const timer = setTimeout(()=>{child.kill(); reject(new Error('Reina smoke exceeded 30 seconds.'));},30000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);resolve(code??1);});
  });
  process.exitCode = code;
} finally {
  const resolved = path.resolve(folder);
  if (!resolved.startsWith(root+path.sep) || !path.basename(resolved).startsWith('.reina-smoke-')) throw new Error('Refusing to clean unexpected smoke directory.');
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
