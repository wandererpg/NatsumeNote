import { describe, expect, it } from 'vitest';

import { translateSummaryToChinese, type SummaryTranslationHttpClient } from '../../src/main/services/summary-translation';

describe('summary translation', () => {
  it('splits long UTF-8 text within the provider limit and translates every segment', async () => {
    const requests: URL[] = [];
    const http: SummaryTranslationHttpClient = {
      fetch: async (url) => {
        const request = new URL(url);
        requests.push(request);
        return {
          ok: true,
          status: 200,
          json: async () => ({ responseStatus: 200, responseData: { translatedText: `译：${request.searchParams.get('q')}` } }),
        };
      },
    };
    const text = `${'An unforgettable summer by the sea. '.repeat(18)}The promise remains.`;

    const translated = await translateSummaryToChinese(text, new AbortController().signal, http);

    expect(requests.length).toBeGreaterThan(1);
    expect(requests.every((request) => Buffer.byteLength(request.searchParams.get('q') ?? '', 'utf8') <= 500)).toBe(true);
    expect(requests.every((request) => request.searchParams.get('langpair') === 'en|zh-CN')).toBe(true);
    expect(translated.match(/译：/gu)).toHaveLength(requests.length);
  });

  it('detects Japanese text and decodes HTML entities returned by the provider', async () => {
    const requests: URL[] = [];
    const http: SummaryTranslationHttpClient = {
      fetch: async (url) => {
        requests.push(new URL(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({ responseStatus: 200, responseData: { translatedText: '&#20320;&#22909;&amp;再见' } }),
        };
      },
    };

    await expect(translateSummaryToChinese('これは夏の物語です。', new AbortController().signal, http)).resolves.toBe('你好&再见');
    expect(requests[0].searchParams.get('langpair')).toBe('ja|zh-CN');
  });

  it('rejects provider quota responses even when they contain placeholder text', async () => {
    const http: SummaryTranslationHttpClient = {
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ responseStatus: 403, responseDetails: 'quota reached', responseData: { translatedText: 'QUOTA FINISHED' } }),
      }),
    };

    await expect(translateSummaryToChinese('A summer story.', new AbortController().signal, http)).rejects.toMatchObject({
      userMessage: '今日免费翻译额度已用完，请稍后再试。',
    });
  });

  it('turns network failures into a useful user-facing error', async () => {
    const http: SummaryTranslationHttpClient = {
      fetch: async () => { throw new Error('socket closed'); },
    };

    await expect(translateSummaryToChinese('A summer story.', new AbortController().signal, http)).rejects.toMatchObject({
      userMessage: '无法连接在线翻译服务，请检查网络后重试。',
    });
  });
});
