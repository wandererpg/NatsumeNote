export type SummaryLanguage = 'en' | 'ja' | 'zh-CN';

/** Distinguish the metadata languages we currently translate without sending Chinese text twice. */
export function detectSummaryLanguage(text: string): SummaryLanguage {
  if (/[\u3040-\u30ff]/u.test(text)) return 'ja';
  const han = text.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  const latin = text.match(/[a-z]/giu)?.length ?? 0;
  return han >= 4 && han > latin ? 'zh-CN' : 'en';
}
