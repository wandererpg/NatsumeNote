import { getErrorMessage } from '../../../../shared/errors';
import type { ReinaAPI } from '../../../../shared/reina';

/**
 * The preload bridge is exposed as `window.galMusic` by `src/preload/index.ts`.
 * Reina methods are optional additions on that same bridge object (see
 * `ReinaAPI` in `src/shared/reina.ts`), so every call site must feature-check
 * before invoking them instead of assuming a fully wired build.
 */
export type ReinaBridge = ReinaAPI;

export type BridgeMethod<K extends keyof ReinaAPI> = ReinaBridge & Required<Pick<ReinaAPI, K>>;

export function getReinaBridge(): ReinaBridge | null {
  const bridge = (globalThis as { galMusic?: unknown }).galMusic;
  return bridge !== null && typeof bridge === 'object' ? (bridge as ReinaBridge) : null;
}

/** Narrow the bridge only when the method really exists on the preload object. */
export function hasBridgeMethod<K extends keyof ReinaAPI>(
  bridge: ReinaBridge | null,
  method: K,
): bridge is BridgeMethod<K> {
  return Boolean(bridge && typeof bridge[method] === 'function');
}

export function reinaErrorMessage(error: unknown, fallback: string): string {
  return getErrorMessage(error, fallback);
}
