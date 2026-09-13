import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

describe('journal creative-workspace layout', () => {
  const css = readFileSync(
    path.resolve(process.cwd(), 'src/renderer/src/styles/globals.css'),
    'utf8',
  );

  it('uses flush Photoshop-style side tools around the free canvas', () => {
    expect(css).toMatch(/\.journal-workspace__body\s*\{[^}]*grid-template-columns:\s*54px minmax\(0, 1fr\) 176px;[^}]*gap:\s*0;/s);
    expect(css).toMatch(/\.journal-toolbox\s*\{[^}]*border-radius:\s*0;/s);
    expect(css).toMatch(/\.journal-inspector\s*\{[^}]*border-radius:\s*0;/s);
  });

  it('renders text blocks as taped sticky notes', () => {
    expect(css).toContain('.journal-block--text::before');
    expect(css).toMatch(/\.journal-block__text-input\s*\{[^}]*border-radius:\s*2px;/s);
  });
});
