import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

interface ProjectPackage {
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
}

describe('Electron native-module setup', () => {
  it('checks an Electron-compatible better-sqlite3 prebuild before dev', () => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as ProjectPackage;
    const scripts = packageJson.scripts ?? {};
    const ensureScript = readFileSync(
      path.resolve(process.cwd(), 'scripts/ensure-electron-native.mjs'),
      'utf8',
    );

    expect(packageJson.engines?.node).toBe('>=20 <23');
    expect(scripts['rebuild:native']).toContain('ensure-electron-native.mjs');
    expect(scripts['rebuild:native:source']).toContain('electron-rebuild');
    expect(scripts['rebuild:native:source']).toContain('better-sqlite3');
    expect(scripts.postinstall).toContain('rebuild:native');
    expect(scripts.predev).toContain('rebuild:native');
    expect(scripts.test).toContain('run-vitest-electron');
    expect(ensureScript).toContain('ELECTRON_RUN_AS_NODE');
    expect(ensureScript).toContain('--runtime=electron');
    expect(ensureScript).toContain('--use-system-ca');
  });
});
