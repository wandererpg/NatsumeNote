/**
 * Renderer-level notification used by the Reina feature. The global tag index
 * (library sidebar) listens for this event and reloads its tags when a binding
 * or a connected ReinaManager source changes.
 */
export const REINA_TAGS_CHANGED_EVENT = 'reina-tags-changed';

/**
 * Dispatches the tag-index invalidation event. Safe when no listener exists,
 * during tests, or when called after unmount (the global index still needs to
 * know that the main-process binding changed).
 */
export function notifyReinaTagsChanged(): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new Event(REINA_TAGS_CHANGED_EVENT));
}
