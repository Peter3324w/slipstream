# Temporary Pause Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resume a live stream after a long pause from a temporary disk recording, deleted on app exit.

**Architecture:** Main records a selected HLS rendition independently of the paused renderer. A token-protected loopback server serves a retained playlist and segments. A renderer coordinator loads that recording at the paused program date, preserving pause/resume intent and discarding stale async results.

**Tech Stack:** Existing Electron, Node filesystem/HTTP/fetch, TypeScript, React and hls.js. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-22-temporary-pause-recording-design.md`

## Global Constraints

- Desktop only; Android bridge remains compatible.
- Delete recordings on stop/channel change/exit, and crashed-session leftovers at startup.
- 4 GiB default disk ceiling; never silently skip missing/unplayed segments.
- One rendition while recording, small browser buffers, original program dates.
- No production builds, new downloads above 50 MB, pushes or merges.
- Keep verified work committed locally on `dev`.

## Review Focus

- User resumes or changes channel before recording preparation completes.
- Old signed segment URLs expire, a playlist skips sequences, or recording reaches its limit.
- Files remain open while cleanup runs on Windows.
- A seek during delayed playback must use retained history and must not jump live.
- Shutdown must await abort/download settlement and file deletion; crash leftovers must be removed next launch.

### Task 1: Recorder and local serving

**Files:** create `src/main/dvr.ts`, `tests/dvr.test.mjs`.

**Interfaces:** export `TemporaryDvr` with constructor `(root: string, options?: { fetch?: typeof fetch; resolveMaster?: () => Promise<string>; maxBytes?: number; pollMs?: number })`, async `initialize()`, `start(masterPlaylist: string, rendition: string, programDateTime: number): Promise<DvrStartResult>`, `status(): DvrStatus`, `updatePosition(mediaSeconds: number)`, async `stop()`, async `dispose()`.

`DvrStartResult = { masterPlaylist: string; startAt: number }`; `DvrStatus = { active: boolean; bytes: number; error: string | null }` in `src/shared/types.ts` (integration task owns this file; recorder may use local structurally identical types).

- [x] Write and run failing synthetic-stream tests.
- [x] Implement HLS parsing/recording, atomic disk publication, polling, one-rendition renewal, retention and error behavior.
- [x] Implement authorized loopback serving and bounded cleanup.
- [x] Verify rollover, renewal, missing sequences, limits, cleanup/startup and cancellation tests.

### Task 2: Pause/resume coordinator and integration

**Files:** create `src/renderer/src/player/pauseRecording.ts`, `tests/pause-recording.test.mjs`; modify `src/main/index.ts`, `src/main/csp.ts`, `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/src/player/hls.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/components/Controls.tsx` and relevant styles if necessary.

**Interfaces:** optional `window.slipstream.dvr` desktop API: `start(rendition: string, programDateTime: number): Promise<DvrStartResult>`, `status(): Promise<DvrStatus>`, `position(mediaSeconds: number): Promise<void>`, `stop(): Promise<void>`. Main validates rendition against its current live master. Add Player pause snapshot, loading suspension and explicit autoplay choice for loading the recorded stream.

- [x] Write failing coordinator tests covering resume-before-ready, cancellation, repeated pause and failed starts.
- [x] Implement testable coordinator, wire video pause/resume, status/progress and Jump Live.
- [x] Initialize main recorder under existing single-instance lock. Await recorder cleanup before quitting and remove crash leftovers before opening the window.
- [x] Add optional preload API and narrowly scoped loopback CSP.
- [x] Explain temporary recording and fixed quality in existing controls; surface errors without replacing preserved playback.

### Task 3: Review, verification and commit

- [x] Review recorder/renderer interface and shutdown races.
- [x] Run all synthetic/existing tests, desktop and mobile typechecks, and diff checks.
- [x] Verify an end-to-end local synthetic stream through the real hls.js player where available without downloading a real live stream.
- [x] Update README with temporary recording lifecycle, storage ceiling, quality behavior and platform scope.
- [x] Commit the complete verified change on `dev` and report evidence and limitations.

## Verification evidence

- `node --test tests/*.test.mjs`: 49 passed, including accelerated 40-minute retention, cancellation, deletion, partial preparation failures, transient retries and startup with inaccessible storage.
- `npm.cmd run typecheck` and `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.mobile.json`: passed.
- `git diff --check`: passed.
- Real Electron window with the actual App, preload IPC, recorder, loopback serving and hls.js decoded a small locally generated MPEG-TS stream. Paused program offset 7.291 seconds remained accessible after the source window's oldest available frame advanced to 8 seconds. The recording started at media offset 1.291 seconds, remained paused, and resumed at 1.993 seconds with the correct program date. Closing through the real window control exited with code 0; the temporary recording directory no longer existed.
- Final independent review approved after fixes. No real Twitch 40-minute session, production build or installer was run. Android recording and full long-pause chat replay are outside this change.
