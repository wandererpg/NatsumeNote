import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';
const root = process.cwd();
if (!fs.existsSync(path.join(root,'out/main/reina-query.js'))) throw new Error('Run npm run build before the Reina smoke check.');
const folder = fs.mkdtempSync(path.join(root,'.reina-smoke-'));
try {
  const entry = path.join(folder,'main.cjs');
  await build({entryPoints:['tests/smoke/reina-main.ts'],outfile:entry,bundle:true,platform:'node',target:'node20',format:'cjs',packages:'external'});
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const code = await new Promise((resolve,reject)=>{
    const child = spawn(electron,[entry,`--reina-smoke-dir=${folder}`],{cwd:root,env,stdio:'inherit',windowsHide:true});
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
