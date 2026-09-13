# Work Scrapbook Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first usable per-game paged scrapbook with an expandable canvas, managed image/video assets, notes, quotes, track/timestamp cards, page soundtrack, tags, online work-detail cards, memory playback, autosave, history, and PNG export.

**Architecture:** SQLite stores one versioned scene document per page and normalized managed-media records. Main-process services own file copying, path containment, media streaming, metadata fetching, and IPC validation; the renderer owns scene editing and a debounced persistence queue. Existing tracks are referenced by ID, while imported images and videos are copied into each game's managed scrapbook directory.

**Tech Stack:** Electron 31, React 18, TypeScript 5, Zustand, better-sqlite3, Vitest, DOM pointer events, HTML Canvas export.

---

### Task 1: Journal domain model and SQLite persistence

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/database/migrations.ts`
- Create: `src/main/database/queries/journal.ts`
- Create: `tests/main/journal-database.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Test migration version 6, game-cascade behavior, ordered page listing, scene round-trip, optimistic revision updates, and soundtrack nulling when a referenced track is deleted.

```ts
const page = createJournalPage(db, {
  id: 'page-1', gameId: 'game-1', title: '序章',
  canvasWidth: 1440, canvasHeight: 1000,
});
expect(saveJournalPage(db, { ...page, revision: 0, tags: ['共通线'] }).revision).toBe(1);
```

- [ ] **Step 2: Run the test and confirm it fails because the journal schema/query module is absent**

Run: `npm test -- tests/main/journal-database.test.ts --run`

- [ ] **Step 3: Add shared discriminated unions and schema**

Define `JournalPage`, `JournalBlock`, `JournalAsset`, `JournalPageDraft`, and `JournalAssetKind`. Add `journal_pages` and `journal_assets`, foreign keys, indexes, JSON columns, and integer revisions.

- [ ] **Step 4: Implement deterministic query mapping and optimistic saves**

Reject a save when `WHERE id = @id AND revision = @revision` updates zero rows. Parse malformed historical JSON to safe empty arrays rather than crashing the library.

- [ ] **Step 5: Run the focused test**

Run: `npm test -- tests/main/journal-database.test.ts --run`

### Task 2: Managed scrapbook media and safe streaming

**Files:**
- Create: `src/shared/journal-media-url.ts`
- Create: `src/main/services/journal-assets.ts`
- Create: `src/main/services/journal-media-protocol.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc/dialog-handlers.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/preload/index.ts`
- Create: `tests/main/journal-assets.test.ts`
- Create: `tests/main/journal-media-protocol.test.ts`
- Modify: `tests/main/ipc.test.ts`
- Modify: `tests/preload/preload.test.ts`

- [ ] **Step 1: Write failing import and protocol tests**

Cover extension allowlists, hash deduplication, copy destination containment, multi-file picker routing, paths outside the configured library, image GET, and video byte ranges.

- [ ] **Step 2: Confirm the focused tests fail for missing APIs**

Run: `npm test -- tests/main/journal-assets.test.ts tests/main/journal-media-protocol.test.ts --run`

- [ ] **Step 3: Implement managed asset import**

Copy images (`png/jpg/jpeg/webp/gif`) and videos (`mp4/webm/ogv/mov`) to `<game>/手账/素材`, name files with UUIDs, retain the original display name, and deduplicate by SHA-256 within a game.

- [ ] **Step 4: Add an allow-listed picker/import IPC**

Expose only `selectJournalMedia(gameId, kind)`. The main process opens the picker and imports selected files before returning records, so the renderer does not choose an arbitrary source path for this operation.

- [ ] **Step 5: Register `galmusic-journal-media`**

Validate absolute paths, extensions, library containment, and Range headers before streaming.

- [ ] **Step 6: Run focused IPC, preload, asset, and protocol tests**

Run: `npm test -- tests/main/journal-assets.test.ts tests/main/journal-media-protocol.test.ts tests/main/ipc.test.ts tests/preload/preload.test.ts --run`

### Task 3: Richer online work details

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/services/game-metadata.ts`
- Modify: `tests/main/game-metadata.test.ts`
- Modify: `tests/renderer/game-editor.test.tsx`

- [ ] **Step 1: Write failing normalization tests**

Expect `releaseDate`, `languages`, `platforms`, `tags`, and `sourceUrl` in sanitized metadata summaries from both VNDB and Bangumi fixtures.

- [ ] **Step 2: Confirm the metadata tests fail on missing fields**

Run: `npm test -- tests/main/game-metadata.test.ts --run`

- [ ] **Step 3: Request and normalize official fields**

Use VNDB `released/languages/platforms/tags.name` and Bangumi `date/platform/meta_tags/tags.name`, cap rendered tags, and preserve only HTTPS source links.

- [ ] **Step 4: Render the imported detail fields in the existing editor**

Keep refresh failures non-fatal and retain cached values.

- [ ] **Step 5: Run metadata and editor tests**

Run: `npm test -- tests/main/game-metadata.test.ts tests/renderer/game-editor.test.tsx --run`

### Task 4: Scene commands, history, autosave, and export model

**Files:**
- Create: `src/renderer/src/features/journal/journal-model.ts`
- Create: `src/renderer/src/features/journal/useJournalHistory.ts`
- Create: `src/renderer/src/features/journal/journal-export.ts`
- Create: `tests/renderer/journal-model.test.ts`
- Create: `tests/renderer/journal-export.test.ts`

- [ ] **Step 1: Write failing pure behavior tests**

Cover default block placement, canvas growth, immutable move/resize/rotate/z-order commands, undo/redo boundaries, timestamp formatting, and export layout clamping.

- [ ] **Step 2: Confirm tests fail for missing modules**

Run: `npm test -- tests/renderer/journal-model.test.ts tests/renderer/journal-export.test.ts --run`

- [ ] **Step 3: Implement typed scene commands**

Use one `updateBlock(page, id, patch)` path, minimum block dimensions, 40px canvas growth increments, and stable z-order normalization.

- [ ] **Step 4: Implement bounded history and debounced save state**

Keep at most 80 snapshots. Coalesce pointer-move previews into one committed history entry on pointer-up.

- [ ] **Step 5: Implement canvas-based PNG rendering**

Draw paper/background, text, quote, track, detail, and media cards. Render a labeled placeholder when a video frame or image cannot be decoded.

- [ ] **Step 6: Run focused model/export tests**

Run: `npm test -- tests/renderer/journal-model.test.ts tests/renderer/journal-export.test.ts --run`

### Task 5: Paged scrapbook editor and application integration

**Files:**
- Create: `src/renderer/src/features/journal/JournalWorkspace.tsx`
- Create: `src/renderer/src/features/journal/JournalCanvas.tsx`
- Create: `src/renderer/src/features/journal/JournalBlockView.tsx`
- Create: `src/renderer/src/features/journal/JournalInspector.tsx`
- Create: `src/renderer/src/features/journal/WorkDetailsCard.tsx`
- Create: `src/renderer/src/features/journal/MemoryMode.tsx`
- Create: `src/renderer/src/features/journal/journal.css`
- Modify: `src/renderer/src/App.tsx`
- Modify: `tests/renderer/components.test.tsx`
- Create: `tests/renderer/journal-workspace.test.tsx`

- [ ] **Step 1: Write failing interaction tests**

Test switching from tracks to scrapbook, creating/renaming/deleting pages, adding text/quote/track/timestamp/details blocks, importing media, changing tags and soundtrack, expanding the canvas, keyboard delete, and persistence status.

- [ ] **Step 2: Confirm the renderer tests fail for the missing workspace**

Run: `npm test -- tests/renderer/journal-workspace.test.tsx --run`

- [ ] **Step 3: Build the workspace shell**

Add `曲目库 / 作品手账 / 作品资料` tabs for a selected game. Keep the persistent player bar available while editing.

- [ ] **Step 4: Build accessible block editing**

Use semantic toolbar buttons, labeled inspector inputs, pointer capture for drag/resize, visible keyboard focus, and editor shortcuts for undo/redo/delete/duplicate.

- [ ] **Step 5: Add the feature cards**

Track cards play existing library tracks; timestamp cards seek before playback; detail cards use cached/refreshable VNDB/Bangumi data; page BGM remains opt-in; tags are searchable labels within the page list.

- [ ] **Step 6: Add memory mode and PNG export actions**

Memory mode presents pages sequentially in a modal and offers the selected soundtrack without forcing autoplay.

- [ ] **Step 7: Run focused renderer tests**

Run: `npm test -- tests/renderer/journal-workspace.test.tsx tests/renderer/components.test.tsx --run`

### Task 6: Full verification and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/GalMusic-实际运行逻辑.md`

- [ ] **Step 1: Document feature use, storage, backup, and online-source behavior**

Explain that assets are managed copies, tracks are references, VNDB/Bangumi need network, and database plus library must be backed up together.

- [ ] **Step 2: Run the full quality gate**

Run: `npm test -- --run`

Run: `npx tsc --noEmit`

Run: `npm run build`

- [ ] **Step 3: Inspect the final diff and request an independent code review**

Resolve every critical or important finding, rerun affected checks, and leave the worktree uncommitted unless the user separately asks to commit or push.
