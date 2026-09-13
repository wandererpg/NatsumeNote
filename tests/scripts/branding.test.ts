import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('application branding', () => {
  const projectRoot = process.cwd();
  const builderConfig = readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8');
  const rendererEntry = readFileSync(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  const welcome = readFileSync(path.join(projectRoot, 'src/renderer/src/components/settings/Welcome.tsx'), 'utf8');
  const sharedPaths = readFileSync(path.join(projectRoot, 'src/shared/paths.ts'), 'utf8');

  it('uses NatsumeNote for the HTML title and Windows product metadata', () => {
    expect(rendererEntry).toContain('<title>NatsumeNote</title>');
    expect(builderConfig).toMatch(/appId:\s*com\.natsumenote\.app/);
    expect(builderConfig).toMatch(/productName:\s*NatsumeNote/);
    expect(builderConfig).toMatch(/executableName:\s*NatsumeNote/);
    expect(builderConfig).toMatch(/shortcutName:\s*NatsumeNote/);
  });

  it('uses NatsumeNote in the welcome copy and new-library default', () => {
    expect(welcome).toContain('NatsumeNote');
    expect(sharedPaths).toContain("'NatsumeNote'");
  });
});
