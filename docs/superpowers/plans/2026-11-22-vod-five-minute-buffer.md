# VOD-backed Five-minute Buffer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Download five-minute VOD batches on demand and record nothing when the current live broadcast has no accessible archive.

**Architecture:** Resolve the live stream's exact `archiveVideo` and its dated archive origin in main. Use the existing temporary disk server with an explicit archive batch mode. The optional desktop bridge returns null for unavailable archives; the renderer restores normal live playback in that case.

**Tech Stack:** Existing Electron, Node, TypeScript, React and hls.js; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-22-vod-five-minute-buffer-design.md`

## Global Constraints

- No live-recording fallback when a VOD is absent, restricted, unrelated or unusable.
- Five-minute initial goal, new five-minute batches at one minute remaining.
- Delete temporary files on stop/channel change/exit and crash leftovers next launch.
- No production builds, pushes, merges, or real-media downloads exceeding 50 MB without approval.
- Commit verified changes locally on dev.

## Review Focus

- A matching ongoing archive differs from merely the latest VOD.
- Archive lag must not silently move the paused frame or change playback intent.
- Ended sources may still contain unfetched batches.
- No downloads while a full batch remains unwatched; continuous archive growth is irrelevant then.
- Old lookups or cancellations cannot create a recording for the next channel.

### Task 1: Archive identification and main integration

Files: create `src/main/live-archive.ts`, `tests/live-archive.test.mjs`; modify `src/main/twitch.ts`, `src/main/index.ts`, shared/preload types and main-boundary tests.

Interfaces: `ongoingArchive(login, streamId)` returns a validated `{id, masterPlaylist}` or null; `archiveOrigin(masterPlaylist)` returns an exact epoch-ms origin from a dated rendition or null. Root owns these files. Main passes `{originDate}` as fourth argument to TemporaryDvr.start and never passes the original live master. Bridge start result becomes `DvrStartResult | null`.

- [x] Write failing source-selection/no-archive tests.
- [x] Implement exact source lookup, date origin, stale-request guards and archive-only renewal.
- [x] Prove no eligible archive causes zero recorder starts.

### Task 2: Five-minute archive buffering

Files: `src/main/dvr.ts`, `tests/dvr.test.mjs` or new `tests/dvr-batches.test.mjs`.

Interface: `start(master, rendition, pausedDate, archive?: {originDate:number})`. Archive mode uses optional origin only for missing timestamps in unambiguous full sequence-zero continuous archive playlists. Legacy direct tests remain compatible; the app uses only archive mode.

- [x] Write failing batch-boundary, pause, refill, growing/ended-source and timeline tests.
- [x] Implement five-minute goals, one-minute low water mark, cancellable initial archive lag, and no fetching while full.
- [x] Preserve prior safety/cleanup/error tests.

### Task 3: Renderer no-archive behavior

Files: pause coordinator, App/Controls and relevant renderer tests.

- [x] Add failing tests for nullable start and pending resume/no-archive cancellation.
- [x] Restore normal live loading on null, show neutral no-VOD state, and prevent fallback recording/repeated attempts.
- [x] Update wording to temporary buffer while preserving quality/Jump Live and deletion semantics.

### Task 4: Review, verification and commit

- [x] Independently review source binding, batch arithmetic, null behavior, cancellation and cleanup.
- [x] Run complete tests, desktop/mobile types and diff checks.
- [x] Verify the full local Electron path with synthetic media, plus metadata-only checks of Agurin/Faide if currently available.
- [x] Update README and verification evidence; commit locally on dev.

## Verification evidence

- `node --test tests/*.test.mjs`: 77 tests passed, including complete prior coverage.
- Desktop and mobile TypeScript checks passed; staged diff check passed.
- Independent review approved archive binding, pinned renewal, timestamp validation, batch suspension/refill and nullable renderer behavior. Added cancellation tests during archive-clock lookup and recorder preparation.
- The actual Electron App/preload/main/HLS flow decoded generated MPEG-TS footage: initial whole-segment batch 302 seconds; zero upstream requests while full; 150 two-second segment requests at refill; original pause resumed; switching to a no-VOD channel returned null and left zero cache sessions. App close exited successfully and removed the temporary recording directory.
- Metadata/playlists-only production probe accepted Agurin's exact ongoing archive `2937467866` and its validated origin `2026-11-22T16:57:48.281Z`. Faide was offline at the check and correctly had no current eligible archive, regardless of older videos.
- No real-video payloads, production build, installer, push or merge were performed. Metadata requests already in flight may finish after cancellation, but invalidated results cannot create media sessions.
