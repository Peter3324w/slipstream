# VOD-backed five-minute pause buffer

Peter wants five-minute download batches: fill five minutes from the paused point, stop downloading while unwatched, and fetch another five when one minute remains. If the channel has no accessible VOD for the current live broadcast (his example is Faide), do not record at all. Delete all temporary media on stop, channel change and app exit; retain crash cleanup and bounded disk/memory behavior.

This supersedes continuous recording as the application's pause fallback. Do not record the live playlist when archive lookup fails or the channel has no ongoing archive.

## Source selection

Use Twitch `user.stream.archiveVideo` to identify the exact ongoing archive. Verify the requested current stream id, ownership, archive type/status and access, then resolve its signed master with the existing anonymous VOD token path. Do not select a finished or unrelated recent VOD. Fetch only metadata/playlists for live verification; no real-media downloads beyond the user's bandwidth approval limit.

The tested Agurin ongoing archive has an accessible growing video playlist. Its video renditions may omit program dates; its audio-only rendition supplies a dated timeline. Resolve a validated time origin from a dated archive rendition; synthesize missing dates using that origin and segment durations only for a full sequence-zero, continuous archive. Reject ambiguous undated discontinuities instead of moving the paused frame. Do not approximate using video creation time.

## Buffer policy

- Keep the existing disk-backed token-protected local server and exact paused-frame start offset.
- Add an explicit archive mode to `TemporaryDvr.start(master, rendition, pausedDate, { originDate })`. The app always uses this mode; the service's legacy mode is retained only for its existing isolated tests.
- Initial goal: five minutes beyond the paused frame, at whole-segment boundaries. If the growing archive has not reached that goal, continue fetching newly published segments until the goal is reached.
- Once the goal is reached, suspend segment and playlist downloads. When playback leaves one minute or less, set the next goal to five minutes beyond the previous downloaded end. Fill that batch, then suspend again. Pause for forty minutes must not cause forty minutes of media to download.
- A near-live pause may need to wait for the archive to publish its frame. Wait with bounded, cancellable playlist retries; never substitute another frame or silently switch to live recording.
- An ended source archive remains refillable until all its unplayed segments have been fetched. Emit local ENDLIST only after the actual source end, or on a terminal error.
- Preserve existing atomic publication, retries, errors retaining playable partial data, four-GiB ceiling, watched-history eviction, cancellation and close cleanup.

## No archive

Main returns `null` from `dvr.start` before calling the recorder when no eligible archive exists. The renderer restores ordinary live loading and shows a neutral 'Live only · No VOD' indication. This state starts no disk session and cannot trigger repeated attempts on every pause. It resets on a channel change. Failures after selecting a source must also never fall back to recording the live stream.

## Verification

Test exact ongoing archive binding, stale/foreign/restricted sources, missing dates and cancellation. Synthetic download tests assert first five-minute goal, zero transfers during a long unwatched pause, refill at the four-minute mark, incremental live-edge filling, ended-source refill, source delay and stop/cleanup. Verify no-VOD invokes no recorder start or segment fetch. Run all tests and desktop/mobile type checks; finish with independent review and a local `dev` commit.
