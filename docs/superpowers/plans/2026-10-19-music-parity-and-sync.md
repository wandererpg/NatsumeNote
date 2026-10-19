# NatsumeMusic parity and manual library exchange

## Scope

Port music-app changes through e9f3b89 into NatsumeNote without replacing its work overview, bilingual summaries, credits, journal pages, assets, or branding. Preserve existing app data and original game files. No packaging, release version changes, publication, or automatic mutation of installed databases.

## Implementation

1. Three-way compare the common ancestor 074e640 and both source trees. Integrate settings persistence, library directory indexing, metadata candidate confirmation, loading feedback, navigation/button motion, archive formats (NWA, AFA, BGI), playback toggle and deletion scroll fixes. Retain Note-specific behavior and its regression tests.
2. Make migrations compatible with both historical schema version sequences, including existing journal tables and metadata-selection fields. Update support must reference the NatsumeNote release repository.
3. Add a versioned local exchange interface to both apps. Export into a newly created package folder containing a JSON manifest and copied managed music/cover files. Import only after a native package selection, preview, and explicit merge action. Do not share SQLite files or transfer settings, journal data, or deletion commands.
4. Merge games and tracks by stable IDs, metadata identities and file hashes. Preserve destination IDs for existing journal references. Show conflicts and offer local/incoming preference. Duplicate imports must be idempotent. Validate manifest types, relative paths, file types, sizes and hashes; reject path traversal/symlinks; use transactional database writes and rollback copied files on failure.
5. Expose export, select package, preview and merge controls in settings, with progress/busy/error/success states and a short usage guide. Keep imported paths within the destination's authorized library.
6. Run focused and full tests, type checking, resource checks and build in both repositories. Review data integrity and trust boundaries. Commit complete work locally in both repositories.

## Acceptance

- Both apps can export a package, preview and import the other's package, including non-ASCII filenames.
- No user data changes during preview; cancellation leaves the database unchanged.
- Existing journal IDs, revisions, cards and assets survive migration and merge.
- Settings save completes; theme/background previews work; existing-directory songs are indexed; metadata can be selected and confirmed.
- NWA, AFA and BGI regressions pass; current-track buttons pause/resume without resetting playback; deletion preserves scroll.
- Reduced-motion preference and keyboard interaction remain supported; failed network metadata requests do not block local use.

## Completion record — 2026-10-19

- Music parity integrated while retaining Note journal, poster shelf, bilingual summaries and rich metadata. Schema 8 handles historical metadata/journal migrations without dropping data.
- Manual export, preview and merge implemented in both apps, with sender-bound preview tokens, file integrity validation, copy rollback, stable destination IDs and union playlist membership.
- Package SHA-256 identifies stored audio; optional source MD5 preserves importer deduplication for converted NWA/OWP audio. Existing version-1 packages without the optional value remain supported.
- Independent review findings resolved, including metadata enrichment preservation, playlist removal, directory remapping for journal media and CSS media-query scope.
- Full Electron/Vitest suites, type checks, resource validation, production renderer builds and isolated fixture-based UI smoke checks completed. User libraries and installed EXEs were not used for smoke checks.
- User workflow documented in `docs/library-sync-guide.md`. No EXE packaging, version bump, push or release.
