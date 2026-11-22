# Temporary recording for long live pauses

Peter pauses live streams for about 40 minutes and wants to resume from the paused frame. The recording must be deleted when the app closes. The existing browser player stops filling its short forward buffer during a long pause; after Twitch's sliding playlist loses the intervening segments, recovery jumps to live.

## Behavior and implementation choices

- Desktop live playback starts normally. The first pause captures the frame's program date and current Twitch rendition and starts a main-process recorder. Pause/resume while watching that recording continues using it. VOD and Android playback retain their existing paths.
- Download one selected rendition continuously, starting with the segment covering the paused frame. Do not fetch older pre-pause history: it may expire during preparation on a slow connection, and is unnecessary for preserving the pause. Serve an HLS playlist and saved segments through a token-protected loopback server. Keep browser buffering small; recorded history lives on disk.
- Recreate the browser player against the recording, at the captured frame's offset, initially paused. If Resume was requested while preparing, play as soon as ready. Keep original segment program dates for synchronized chat.
- Recording locks quality to the rendition selected at pause. Jumping Live returns to ordinary playback and restores the normal quality choices. Explain this briefly in the controls.
- Default storage ceiling: 4 GiB, an implementation choice. Remove already-watched segments more than two minutes behind the recording playhead. Never evict the paused frame or unplayed backlog to make room. At the ceiling, storage failure, missing segments, or unrecoverable network failure, stop recording and explain why; retain playable data and never silently jump live.
- Renew expired signed URLs in the recorder, retaining segment identity and the recorded timeline. Never silently splice a missing interval.
- Stop, channel/VOD changes, and application exit abort downloads, close file/server handles and delete the app-owned temporary directory. Before a new launch, delete leftovers from a crash. Existing single-instance locking prevents another app instance from sharing cleanup.
- Renderer input selects a rendition from the main process's last resolved live master; it cannot supply arbitrary URLs or filesystem paths. Loopback routes expose only generated session/segment identifiers and require an unguessable token. Restrict cleanup to the app's dedicated cache root.

## Validation

Use small synthetic HLS streams and fake clocks/fetching to verify paused-frame retention after playlist rollover, continuous downloads while paused, published files, discontinuities, signed URL renewal, limits, abort races, stop/dispose deletion, restart cleanup and loopback authorization. Test renderer resume-before-ready and stop/channel-change races. Run desktop/mobile typechecks and the existing tests. No production builds or large real-stream downloads are authorized by this implementation.
