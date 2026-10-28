/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import packageMetadata from '../../package.json';
import { APP_DISPLAY_VERSION, APP_VERSION, APP_WINDOW_TITLE } from '../../src/shared/version';
import { TitleBar } from '../../src/renderer/src/components/layout/TitleBar';

afterEach(() => {
  cleanup();
  document.title = '';
});

describe('application version', () => {
  it('keeps package, lockfile and user-facing version consistent', () => {
    const lockfile = JSON.parse(readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8'));
    expect(APP_VERSION).toBe('1.2.0');
    expect(APP_VERSION).toBe(packageMetadata.version);
    expect(lockfile.version).toBe(APP_VERSION);
    expect(lockfile.packages[''].version).toBe(APP_VERSION);
    expect(APP_DISPLAY_VERSION).toBe('v_1.2');
  });

  it('shows v_1.2 in the title bar and browser tab', () => {
    render(<TitleBar />);
    expect(screen.getByLabelText('当前版本 v_1.2')).toBeVisible();
    expect(screen.getByText('NatsumeNote')).toBeInTheDocument();
    expect(document.title).toBe(APP_WINDOW_TITLE);
    expect(document.title).toBe('NatsumeNote v_1.2');
  });
});
