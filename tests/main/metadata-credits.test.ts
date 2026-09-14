import { describe, expect, it } from 'vitest';

import { fetchMetadataCredits } from '../../src/main/services/metadata-credits';
import type { MetadataHttpClient } from '../../src/main/services/game-metadata';

function response(value: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => value,
    text: async () => JSON.stringify(value),
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

describe('metadata credits', () => {
  it('normalizes VNDB main characters, voice actors, and production staff', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const http: MetadataHttpClient = {
      fetch: async (url, init) => {
        requests.push({ url, body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> });
        if (url.endsWith('/character')) {
          return response({ results: [
            { id: 'c2', name: 'Minamo', original: '水菜萌', description: 'A close friend.', image: { url: 'https://img.example/minamo.jpg' }, vns: [{ id: 'v1', role: 'primary', spoiler: 0 }] },
            { id: 'c1', name: 'Atri', original: 'アトリ', description: 'A mechanical girl.', image: { url: 'https://img.example/atri.jpg' }, vns: [{ id: 'v1', role: 'main', spoiler: 0 }] },
          ] });
        }
        return response({ results: [{
          staff: [{ id: 's1', name: 'Asuta Konno', original: '紺野アスタ', role: 'scenario', note: null }],
          va: [{ staff: { id: 's2', name: 'Hikaru Akao', original: '赤尾ひかる' }, character: { id: 'c1' } }],
        }] });
      },
    };

    const result = await fetchMetadataCredits('vndb', 'v1', new AbortController().signal, http);

    expect(result.characters).toEqual([
      expect.objectContaining({ externalId: 'c1', name: 'Atri', originalName: 'アトリ', role: 'main', voiceActors: ['Hikaru Akao'] }),
      expect.objectContaining({ externalId: 'c2', name: 'Minamo', role: 'primary', voiceActors: [] }),
    ]);
    expect(result.staff).toEqual([
      expect.objectContaining({ externalId: 's1', name: 'Asuta Konno', originalName: '紺野アスタ', role: 'scenario' }),
    ]);
    expect(requests.map((request) => request.url)).toEqual([
      'https://api.vndb.org/kana/character',
      'https://api.vndb.org/kana/vn',
    ]);
    expect(JSON.stringify(requests[0].body.filters)).toContain('v1');
  });

  it('normalizes Bangumi related characters and people', async () => {
    const http: MetadataHttpClient = {
      fetch: async (url) => url.endsWith('/characters')
        ? response([{
          id: 10, name: 'アトリ', summary: '高性能机器人。', relation: '主角',
          images: { grid: 'http://lain.bgm.tv/pic/crt/g/atri.jpg' }, actors: [{ name: '赤尾ひかる' }],
        }])
        : response([{
          id: 20, name: '紺野アスタ', relation: '剧本', career: ['writer'], images: { grid: 'https://lain.bgm.tv/pic/prsn/g/asuta.jpg' },
        }]),
    };

    const result = await fetchMetadataCredits('bangumi', '100', new AbortController().signal, http);

    expect(result.characters[0]).toMatchObject({
      externalId: '10', name: 'アトリ', role: '主角', description: '高性能机器人。',
      imageUrl: 'https://lain.bgm.tv/pic/crt/g/atri.jpg', voiceActors: ['赤尾ひかる'],
    });
    expect(result.staff[0]).toMatchObject({ externalId: '20', name: '紺野アスタ', role: '剧本' });
  });
});
