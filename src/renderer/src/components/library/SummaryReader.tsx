import { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import { detectSummaryLanguage } from '../../../../shared/summary-language';

export type SummaryView = 'chinese' | 'original' | 'bilingual';

export interface SummaryReaderProps {
  original: string;
  translated: string | null;
  onTranslate?: () => Promise<string>;
}

/** Keep cached metadata intact; render BBCode as plain text rather than HTML. */
function summaryDisplayText(summary: string): string {
  return summary
    .replace(/(?:^|\r?\n)[ \t]*\[\s*from\s+\[url(?:\s*=\s*[^\]\r\n]*)?\](?:(?!\[\/url\])[^\r\n])*\[\/url\][ \t]*\][ \t]*(?:\r?\n[ \t]*)*$/i, '')
    .replace(/\[(?:br|hr)\s*\/?\]/gi, '\n')
    .replace(/\[\/?(?:url|email|img|b|i|u|s|strike|spoiler|quote|code|raw|size|color|font|align|center|left|right|list|li)(?:\s*=\s*[^\]\r\n]*)?\]/gi, '')
    .replace(/\[\*\]/g, '')
    .trim();
}

export function SummaryReader({ original, translated, onTranslate }: SummaryReaderProps) {
  const [translation, setTranslation] = useState<string | null>(translated);
  const [view, setView] = useState<SummaryView>(translated ? 'chinese' : 'original');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayedOriginal = summaryDisplayText(original);
  const displayedTranslation = translation === null ? null : summaryDisplayText(translation);
  const canTranslate = Boolean(onTranslate && detectSummaryLanguage(displayedOriginal) !== 'zh-CN');

  useEffect(() => {
    setTranslation(translated);
    setView(translated ? 'chinese' : 'original');
    setError(null);
  }, [original, translated]);

  const translate = async () => {
    if (!onTranslate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const value = await onTranslate();
      setTranslation(value);
      setView('bilingual');
    } catch (translationError) {
      setError(translationError instanceof Error ? translationError.message : String(translationError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="summary-reader" aria-label="作品简介">
      <div className="summary-reader__toolbar">
        <span>作品简介</span>
        {translation ? (
          <div className="summary-reader__modes" role="group" aria-label="简介语言">
            <button type="button" aria-label="仅显示中文" aria-pressed={view === 'chinese'} onClick={() => setView('chinese')}>中文</button>
            <button type="button" aria-label="仅显示原文" aria-pressed={view === 'original'} onClick={() => setView('original')}>原文</button>
            <button type="button" aria-label="中文与原文双语对照" aria-pressed={view === 'bilingual'} onClick={() => setView('bilingual')}>双语</button>
          </div>
        ) : canTranslate ? (
          <button className="summary-reader__translate" type="button" aria-label="翻译为中文" disabled={busy} onClick={() => { void translate(); }}>
            <Languages size={13} aria-hidden="true" />{busy ? '翻译中…' : '译为中文'}
          </button>
        ) : null}
      </div>

      <div className="summary-reader__scroll" role="region" aria-label="简介正文" tabIndex={0}>
        {translation && view !== 'original' && (
          <div className="summary-reader__text summary-reader__text--translated">
            {view === 'bilingual' && <span>中文译文</span>}
            <p>{displayedTranslation}</p>
          </div>
        )}
        {(!translation || view !== 'chinese') && (
          <div className="summary-reader__text">
            {translation && view === 'bilingual' && <span>原文</span>}
            <p>{displayedOriginal}</p>
          </div>
        )}
      </div>
      {error && <p className="summary-reader__error" role="alert">{error}</p>}
      {!translation && canTranslate && <small>按需使用在线机器翻译，译文会保存在本地。</small>}
    </section>
  );
}
