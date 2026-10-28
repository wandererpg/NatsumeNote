import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

/** Measure buttons so the selection follows text size and window resizing. */
export function useSelectionIndicator(selection: string | null, selector = 'button.is-active') {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  useLayoutEffect(() => {
    const group = ref.current;
    if (!group) return;
    const measure = () => {
      const selected = group.querySelector<HTMLElement>(selector);
      const bounds = selected?.getBoundingClientRect();
      const origin = group.getBoundingClientRect();
      setStyle(previous => selected ? {
        opacity: 1,
        width: selected.offsetWidth,
        height: selected.offsetHeight,
        transform: `translate(${bounds!.left - origin.left + group.scrollLeft}px, ${bounds!.top - origin.top + group.scrollTop}px)`,
      } : { ...previous, opacity: 0 });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(group);
    group.querySelectorAll('button').forEach(button => observer?.observe(button));
    return () => observer?.disconnect();
  }, [selection, selector]);
  return { ref, style };
}
