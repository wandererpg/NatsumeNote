import { animate, type JSAnimation } from 'animejs';
import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Animate wrappers, leaving the canvas zoom and the cards' rotation untouched. */
export function useJournalMotion(
  stage: RefObject<HTMLDivElement>,
  inspector: RefObject<HTMLElement>,
  pageId: string,
  blockIds: string[],
  inspectorOpen: boolean,
) {
  const previousPage = useRef('');
  const previousBlocks = useRef(new Set<string>());
  const ids = blockIds.join('\0');

  useLayoutEffect(() => {
    const changedPage = previousPage.current !== pageId;
    const added = blockIds.filter(id => !previousBlocks.current.has(id));
    previousPage.current = pageId;
    previousBlocks.current = new Set(blockIds);
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!preference || preference.matches || !stage.current || !pageId) return;
    const animations: JSAnimation[] = [];
    if (changedPage) {
      animations.push(animate(stage.current, {
        opacity: [0.45, 1], y: [10, 0], duration: 220, ease: 'outCubic',
      }));
    } else {
      stage.current.querySelectorAll<HTMLElement>('[data-journal-block]').forEach(element => {
        if (!added.includes(element.dataset.journalBlock ?? '')) return;
        const surface = element.querySelector<HTMLElement>('.journal-block__surface');
        if (surface) animations.push(animate(surface, {
          opacity: [0.25, 1], scale: [0.96, 1], duration: 200, ease: 'outCubic',
        }));
      });
    }
    const stop = () => animations.forEach(animation => animation.revert());
    const onChange = () => { if (preference.matches) stop(); };
    preference.addEventListener('change', onChange);
    return () => { stop(); preference.removeEventListener('change', onChange); };
    // The serialised IDs prevent text edits from restarting entrance animations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, pageId, ids]);

  useLayoutEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!inspectorOpen || !inspector.current || !preference || preference.matches) return;
    const animation = animate(inspector.current, { opacity: [0.4, 1], x: [8, 0], duration: 180, ease: 'outCubic' });
    const stop = () => animation.revert();
    const onChange = () => { if (preference.matches) stop(); };
    preference.addEventListener('change', onChange);
    return () => { stop(); preference.removeEventListener('change', onChange); };
  }, [inspector, inspectorOpen]);
}
