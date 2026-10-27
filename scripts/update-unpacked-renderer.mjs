import assert from 'node:assert/strict';
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import asar from '@electron/asar';

// Update an existing unpacked application without rebuilding its runtime or dependencies.
const root = process.cwd();
assert.ok(process.argv[2], 'Pass the existing win-unpacked directory.');
const target = path.resolve(process.argv[2]);
const archive = path.join(target, 'resources', 'app.asar');
assert.ok(existsSync(path.join(target, 'NatsumeNote.exe')), 'Existing NatsumeNote.exe is required.');
assert.ok(existsSync(archive), 'Existing app.asar is required.');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const tools = path.join(root, '.packaging-tools');
mkdirSync(tools, { recursive: true });
const stage = mkdtempSync(path.join(tools, 'inplace-renderer-'));
const source = path.join(stage, 'app');
const candidate = path.join(stage, 'app.asar');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const originalHash = digest(readFileSync(archive));
const backup = path.join(tools, `app-before-${version}-${stamp}.asar`);
const pending = path.join(target, 'resources', `app.asar.pending-${stamp}`);
let installed = false;

function extract(filename, relative) {
  return asar.extractFile(filename, path.normalize(relative));
}

function archiveFiles(filename) {
  const result = new Map();
  function walk(directory, prefix = '') {
    for (const [name, entry] of Object.entries(directory.files ?? {})) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (entry.files) walk(entry, relative);
      else result.set(relative, entry);
    }
  }
  walk(asar.getRawHeader(filename).header);
  return result;
}

function filesIn(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesIn(path.join(directory, entry.name), relative) : [relative];
  });
}

function withinStage(filename) {
  const relative = path.relative(stage, path.resolve(filename));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Cleanup must stay inside staging.');
}

try {
  const original = archiveFiles(archive);
  const oldMetadata = JSON.parse(extract(archive, 'package.json').toString());
  assert.equal(oldMetadata.name, 'natsume-note');
  assert.equal(oldMetadata.main, './out/main/index.js');
  // Refuse to mix an unrelated backend with this renderer.
  for (const [relative, entry] of original) {
    if ((relative.startsWith('out/main/') || relative.startsWith('out/preload/')) && !entry.link) {
      assert.deepEqual(extract(archive, relative), readFileSync(path.join(root, relative)), `Backend differs: ${relative}`);
    }
  }
  const nativeDirectory = `${archive}.unpacked`;
  const nativeHashes = new Map(filesIn(nativeDirectory).map(relative => [relative, digest(readFileSync(path.join(nativeDirectory, relative)))]));
  const executableHash = digest(readFileSync(path.join(target, 'NatsumeNote.exe')));
  asar.extractAll(archive, source);
  const renderer = path.join(source, 'out', 'renderer');
  withinStage(renderer);
  rmSync(renderer, { recursive: true, force: true });
  cpSync(path.join(root, 'out', 'renderer'), renderer, { recursive: true });
  writeFileSync(path.join(source, 'package.json'), JSON.stringify({ ...oldMetadata, version }, null, 2) + '\n');
  await asar.createPackageWithOptions(source, candidate, { unpackDir: 'node_modules/better-sqlite3' });

  const updated = archiveFiles(candidate);
  for (const [relative, entry] of original) {
    if (relative === 'package.json' || relative.startsWith('out/renderer/')) continue;
    assert.ok(updated.has(relative), `Missing original file: ${relative}`);
    assert.equal(Boolean(updated.get(relative).unpacked), Boolean(entry.unpacked), `Unpack flag changed: ${relative}`);
    assert.deepEqual(extract(candidate, relative), extract(archive, relative), `Original file changed: ${relative}`);
  }
  const renderedFiles = filesIn(path.join(root, 'out', 'renderer'));
  assert.deepEqual([...updated.keys()].filter(relative => relative.startsWith('out/renderer/')).sort(), renderedFiles.map(relative => `out/renderer/${relative}`).sort());
  for (const relative of renderedFiles) {
    assert.deepEqual(extract(candidate, `out/renderer/${relative}`), readFileSync(path.join(root, 'out', 'renderer', relative)));
  }
  const html = extract(candidate, 'out/renderer/index.html').toString();
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"?#]+)"/g)) {
    assert.ok(updated.has(path.posix.join('out/renderer', match[1])), `Missing renderer asset: ${match[1]}`);
  }
  assert.deepEqual(JSON.parse(extract(candidate, 'package.json').toString()), { ...oldMetadata, version });
  assert.equal(digest(readFileSync(archive)), originalHash, 'Original archive changed during preparation.');
  const candidateHash = digest(readFileSync(candidate));
  copyFileSync(archive, backup, constants.COPYFILE_EXCL);
  // Retain a matching backup of unpacked dependencies for a recoverable ASAR pair.
  cpSync(nativeDirectory, `${backup}.unpacked`, { recursive: true, errorOnExist: true, force: false });
  copyFileSync(candidate, pending, constants.COPYFILE_EXCL);
  renameSync(pending, archive);
  installed = true;
  asar.uncache(archive);
  assert.equal(digest(readFileSync(archive)), candidateHash);
  assert.equal(digest(readFileSync(path.join(target, 'NatsumeNote.exe'))), executableHash);
  for (const [relative, expected] of nativeHashes) {
    assert.equal(digest(readFileSync(path.join(nativeDirectory, relative))), expected, `Native dependency changed: ${relative}`);
  }
  assert.equal(JSON.parse(extract(archive, 'package.json').toString()).version, version);
  const report = { target, version, backup, previousVersion: oldMetadata.version, previousSha256: originalHash, sha256: candidateHash, rendererFiles: renderedFiles.length, preservedFiles: original.size - [...original.keys()].filter(relative => relative.startsWith('out/renderer/') || relative === 'package.json').length, nativeFiles: nativeHashes.size, executableUnchanged: true };
  writeFileSync(path.join(tools, `inplace-update-${stamp}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (installed && existsSync(backup)) {
    copyFileSync(backup, pending);
    renameSync(pending, archive);
    asar.uncache(archive);
  }
  throw error;
} finally {
  if (existsSync(pending)) rmSync(pending);
  assert.equal(path.dirname(stage), tools);
  assert.ok(path.basename(stage).startsWith('inplace-renderer-'));
  rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
