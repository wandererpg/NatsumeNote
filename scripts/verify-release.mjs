// Verify local Windows release files; --exe-only skips the optional ZIPs.
// No installation or publication is performed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const yaml = require('js-yaml');
const path7za = await require('builder-util/out/7za').getPath7za();
const root = process.cwd();
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const output = path.resolve(process.argv.slice(2).find(argument => argument !== '--exe-only') ?? `release-v${pkg.version}`);
const exeOnly = process.argv.includes('--exe-only');
const unpacked = path.join(output, 'win-unpacked');
const archive = path.join(unpacked, 'resources', 'app.asar');
const bundled = JSON.parse(asar.extractFile(archive, 'package.json').toString());
assert.equal(bundled.version, pkg.version);
assert.equal(bundled.main, './out/main/index.js');
for (const parts of [['out', 'main', 'index.js'], ['out', 'main', 'reina-query.js'], ['out', 'preload', 'index.js']]) {
  assert.deepEqual(asar.extractFile(archive, path.join(...parts)), await fs.readFile(path.join(root, ...parts)));
}
async function verifyRenderer(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await verifyRenderer(filename);
    else assert.deepEqual(asar.extractFile(archive, path.relative(root, filename)), await fs.readFile(filename));
  }
}
await verifyRenderer(path.join(root, 'out', 'renderer'));
const feed = yaml.load(await fs.readFile(path.join(unpacked, 'resources', 'app-update.yml'), 'utf8'));
assert.equal(feed.provider, 'github');
assert.equal(feed.owner, 'wandererpg');
assert.equal(feed.repo, 'NatsumeNote');
const latest = yaml.load(await fs.readFile(path.join(output, 'latest.yml'), 'utf8'));
assert.equal(latest.version, pkg.version);
const installerName = `NatsumeNote-${pkg.version}-x64.exe`;
assert.equal(latest.path, installerName);
const installer = await fs.readFile(path.join(output, installerName));
const sha512 = createHash('sha512').update(installer).digest('base64');
assert.equal(latest.sha512, sha512);
assert.equal(latest.files[0].url, installerName);
assert.equal(latest.files[0].sha512, sha512);
assert.equal(latest.files[0].size, installer.length);
assert.ok((await fs.stat(path.join(output, `${installerName}.blockmap`))).size > 0);

const probe = path.join(root, '.packaging-tools', 'verify-packaged-sqlite.cjs');
await fs.mkdir(path.dirname(probe), { recursive: true });
await fs.writeFile(probe, `const Database = require(${JSON.stringify(path.join(archive, 'node_modules', 'better-sqlite3'))});
const db = new Database(':memory:');
db.exec('CREATE TABLE probe(value TEXT)');
db.prepare('INSERT INTO probe VALUES (?)').run('native sqlite ok');
console.log(JSON.stringify({value:db.prepare('SELECT value FROM probe').get().value,integrity:db.pragma('integrity_check',{simple:true})}));
db.close();`);
const smoke = spawnSync(path.join(unpacked, 'NatsumeNote.exe'), [probe], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true, timeout: 30000,
});
assert.equal(smoke.status, 0, smoke.stderr || String(smoke.error));
const native = JSON.parse(smoke.stdout.trim());
assert.deepEqual(native, { value: 'native sqlite ok', integrity: 'ok' });

const portableName = `NatsumeNote-${pkg.version}-windows-x64-portable.zip`;
const installerZipName = `NatsumeNote-${pkg.version}-windows-x64-installer.zip`;
const zipSpecs = exeOnly ? [] : [
  { name: portableName, folder: `NatsumeNote-${pkg.version}-portable`, source: unpacked },
  { name: installerZipName, folder: `NatsumeNote-${pkg.version}-installer`, source: path.join(output,installerName) },
];
// Refuse existing ZIPs: updating an archive could retain obsolete files.
for (const spec of zipSpecs) await assert.rejects(fs.stat(path.join(output,spec.name)), {code:'ENOENT'});
const staging = await fs.mkdtemp(path.join(output,'.zip-staging-'));
try {
  for (const spec of zipSpecs) {
    const directory = path.join(staging,spec.folder);
    if (spec.source === unpacked) await fs.cp(unpacked,directory,{recursive:true});
    else {
      await fs.mkdir(directory);
      await fs.copyFile(spec.source,path.join(directory,installerName));
    }
    const zip = path.join(output,spec.name);
    for (const args of [['a','-tzip','-mx=5',zip,spec.folder],['t',zip]]) {
      const result = spawnSync(path7za,args,{cwd:staging,encoding:'utf8',windowsHide:true});
      assert.equal(result.status,0,result.stderr || result.stdout);
    }
  }
} finally {
  assert.equal(path.dirname(staging),output);
  assert.ok(path.basename(staging).startsWith('.zip-staging-'));
  await fs.rm(staging,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
const names = [installerName, `${installerName}.blockmap`, 'latest.yml', ...zipSpecs.map(spec => spec.name)];
const sums = [];
for (const name of names) {
  const hash = createHash('sha256').update(await fs.readFile(path.join(output, name))).digest('hex');
  sums.push(`${hash}  ${name}`);
}
await fs.writeFile(path.join(output, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
const report = { version: pkg.version, bundledCodeMatches: true, provider: feed.provider, owner: feed.owner, repo: feed.repo, installerMetadataMatches: true, native, portableIntegrity: exeOnly ? 'not-generated' : 'ok', installerZipIntegrity: exeOnly ? 'not-generated' : 'ok', artifacts: names };
await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
