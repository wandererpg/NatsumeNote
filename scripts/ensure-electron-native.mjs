import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import electronPath from 'electron';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const moduleRoot = path.join(projectRoot, 'node_modules', 'better-sqlite3');
const prebuildInstaller = path.join(projectRoot, 'node_modules', 'prebuild-install', 'bin.js');
const electronPackage = JSON.parse(
  readFileSync(path.join(projectRoot, 'node_modules', 'electron', 'package.json'), 'utf8'),
);

function probeNativeModule() {
  return spawnSync(
    electronPath,
    [
      '-e',
      "const Database=require('better-sqlite3');const db=new Database(':memory:');db.prepare('SELECT 1').get();db.close();",
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    },
  );
}

const initialProbe = probeNativeModule();
if (initialProbe.status === 0) {
  console.log(`better-sqlite3 is ready for Electron ${electronPackage.version}.`);
  process.exit(0);
}

console.log(`Preparing better-sqlite3 for Electron ${electronPackage.version}...`);
const nodeArguments = [];
if (process.allowedNodeEnvironmentFlags.has('--use-system-ca')) {
  nodeArguments.push('--use-system-ca');
}
nodeArguments.push(
  prebuildInstaller,
  '--runtime=electron',
  `--target=${electronPackage.version}`,
  `--arch=${process.arch}`,
  `--platform=${process.platform}`,
  '--verbose',
);

const installEnvironment = { ...process.env };
// npm injects npm_config_cache for lifecycle scripts. Removing only that
// override lets prebuild-install reuse its normal APPDATA cache on Windows.
delete installEnvironment.npm_config_cache;
delete installEnvironment.NPM_CONFIG_CACHE;

const install = spawnSync(process.execPath, nodeArguments, {
  cwd: moduleRoot,
  env: installEnvironment,
  stdio: 'inherit',
});

if (install.status !== 0) {
  console.error([
    '',
    'Unable to install the official better-sqlite3 prebuilt binary.',
    'Use Node.js 20 or 22 LTS for this project and check the network/certificate configuration.',
    'To compile from source instead, install Python and Visual Studio Desktop development with C++,',
    'then run: npm run rebuild:native:source',
  ].join('\n'));
  process.exit(install.status ?? 1);
}

const finalProbe = probeNativeModule();
if (finalProbe.status !== 0) {
  process.stderr.write(finalProbe.stderr || 'Electron could not load better-sqlite3 after installation.\n');
  process.exit(finalProbe.status ?? 1);
}

console.log(`better-sqlite3 is ready for Electron ${electronPackage.version}.`);
