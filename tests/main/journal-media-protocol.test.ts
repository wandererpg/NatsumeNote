import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { registerJournalMediaProtocol } from '../../src/main/services/journal-media-protocol';
import { toJournalMediaUrl } from '../../src/shared/journal-media-url';

type MediaHandler = (request: { url: string; headers?: Headers }) => Response | Promise<Response>;

describe('journal media protocol', () => {
  it('serves images inside the configured library', async () => {
    let handler: MediaHandler | undefined;
    const fetchFile = vi.fn(async () => new Response('image-bytes'));
    registerJournalMediaProtocol({
      protocol: { handle: vi.fn((_scheme: string, next: MediaHandler) => { handler = next; }) },
      fetchFile,
      getLibraryPath: () => 'C:\\Music',
    });

    const response = await handler!({ url: toJournalMediaUrl('C:\\Music\\ATRI\\手账\\素材\\a.png') });
    expect(response.status).toBe(200);
    expect(fetchFile).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\/\/C:\/Music/));
  });

  it('supports video ranges and rejects paths outside the library', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'natsume-journal-media-'));
    const library = path.join(root, 'library');
    const mediaPath = path.join(library, 'game', '手账', '素材', 'scene.mp4');
    await mkdir(path.dirname(mediaPath), { recursive: true });
    await writeFile(mediaPath, '0123456789');
    let handler: MediaHandler | undefined;

    try {
      registerJournalMediaProtocol({
        protocol: { handle: vi.fn((_scheme: string, next: MediaHandler) => { handler = next; }) },
        fetchFile: vi.fn(),
        getLibraryPath: () => library,
      });
      const partial = await handler!({
        url: toJournalMediaUrl(mediaPath),
        headers: new Headers({ Range: 'bytes=3-6' }),
      });
      expect(partial.status).toBe(206);
      expect(partial.headers.get('content-type')).toBe('video/mp4');
      expect(Buffer.from(await partial.arrayBuffer()).toString()).toBe('3456');

      const denied = await handler!({ url: toJournalMediaUrl(path.join(root, 'outside.png')) });
      expect(denied.status).toBe(403);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
