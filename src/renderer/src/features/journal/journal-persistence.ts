import type { JournalPage, JournalPageDraft } from '../../../../shared/types';

export interface JournalSaveSession {
  page: JournalPage;
  dirty: boolean;
  revisions: Map<string, number>;
  job: Promise<boolean> | null;
}

const pendingSaves = new Map<string, Promise<boolean>>();
const unsavedSessions = new Map<string, JournalSaveSession>();

export async function waitForJournalSaves(gameId: string): Promise<JournalSaveSession | undefined> {
  await pendingSaves.get(gameId);
  return unsavedSessions.get(gameId);
}

// The session outlives its view, so leaving during a write also saves later typing.
export function saveJournalSession(
  session: JournalSaveSession,
  save: (draft: JournalPageDraft) => Promise<JournalPage>,
  onSaved: (saved: JournalPage) => void,
  onError: (error: unknown) => void,
): Promise<boolean> {
  if (session.job) return session.job;
  if (!session.dirty || !session.page.id) return Promise.resolve(true);
  const gameId = session.page.gameId;
  unsavedSessions.set(gameId, session);
  const job = (async () => {
    try {
      while (session.dirty) {
        const snapshot = session.page;
        const saved = await save({
          id: snapshot.id, gameId: snapshot.gameId, title: snapshot.title,
          position: snapshot.position, canvasWidth: snapshot.canvasWidth, canvasHeight: snapshot.canvasHeight,
          background: snapshot.background, blocks: snapshot.blocks, tags: snapshot.tags,
          soundtrackTrackId: snapshot.soundtrackTrackId,
          revision: session.revisions.get(snapshot.id) ?? snapshot.revision,
        });
        session.revisions.set(saved.id, saved.revision);
        if (session.page === snapshot) {
          session.page = saved;
          session.dirty = false;
        } else {
          session.page = { ...session.page, revision: saved.revision, updatedAt: saved.updatedAt };
        }
        onSaved(saved);
      }
      if (unsavedSessions.get(gameId) === session) unsavedSessions.delete(gameId);
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  })();
  session.job = job;
  pendingSaves.set(gameId, job);
  void job.finally(() => {
    if (session.job === job) session.job = null;
    if (pendingSaves.get(gameId) === job) pendingSaves.delete(gameId);
  });
  return job;
}
