import { useCallback, useEffect, useState } from 'react';

import type { JournalPage } from '../../../../shared/types';

export interface JournalHistoryState {
  past: JournalPage[];
  present: JournalPage;
  future: JournalPage[];
}
export function createJournalHistory(initial: JournalPage): JournalHistoryState {
  return { past: [], present: initial, future: [] };
}

export function commitJournalHistory(
  state: JournalHistoryState,
  next: JournalPage,
  limit = 80,
): JournalHistoryState {
  return {
    past: [...state.past, state.present].slice(-limit),
    present: next,
    future: [],
  };
}

export function undoJournalHistory(state: JournalHistoryState): JournalHistoryState {
  const previous = state.past[state.past.length - 1];
  if (!previous) return state;
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
  };
}

export function redoJournalHistory(state: JournalHistoryState): JournalHistoryState {
  const next = state.future[0];
  if (!next) return state;
  return {
    past: [...state.past, state.present],
    present: next,
    future: state.future.slice(1),
  };
}

export interface JournalHistoryController {
  page: JournalPage;
  canUndo: boolean;
  canRedo: boolean;
  commit(next: JournalPage): void;
  replace(next: JournalPage): void;
  undo(): void;
  redo(): void;
}

export function useJournalHistory(initial: JournalPage | null): JournalHistoryController {
  const [state, setState] = useState<JournalHistoryState | null>(
    initial ? createJournalHistory(initial) : null,
  );

  useEffect(() => {
    if (!initial) {
      setState(null);
      return;
    }
    setState((current) => current?.present.id === initial.id ? current : createJournalHistory(initial));
  }, [initial]);

  const commit = useCallback((next: JournalPage) => {
    setState((current) => current ? commitJournalHistory(current, next) : createJournalHistory(next));
  }, []);
  const replace = useCallback((next: JournalPage) => {
    setState((current) => current ? { ...current, present: next } : createJournalHistory(next));
  }, []);
  const undo = useCallback(() => setState((current) => current ? undoJournalHistory(current) : current), []);
  const redo = useCallback(() => setState((current) => current ? redoJournalHistory(current) : current), []);

  return {
    page: state?.present ?? initial ?? createFallbackPage(),
    canUndo: Boolean(state?.past.length),
    canRedo: Boolean(state?.future.length),
    commit,
    replace,
    undo,
    redo,
  };
}

function createFallbackPage(): JournalPage {
  const now = new Date().toISOString();
  return {
    id: '',
    gameId: '',
    title: '',
    position: 0,
    canvasWidth: 960,
    canvasHeight: 680,
    background: { color: '#fffaf0', pattern: 'paper' },
    blocks: [],
    tags: [],
    soundtrackTrackId: null,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}
