# Probes

Throwaway instrumentation that answers questions the design rests on, before
any application code exists.

## Open question #4 — can we seek past a stitched mid-roll?

The ad strategy in the main README is *watch on delay, then skip forward over
stitched mid-rolls*. That is only viable if a forward seek across an ad
boundary actually recovers. Twitch inserts ads with an HLS discontinuity, and
ad segments can carry different encoding parameters from the content — which
forces the decoder to re-initialise mid-stream. **If mpv stalls there, the
strategy is dead** and the design needs rethinking.

Nothing in the repo answers that yet. These two probes do.

### `playlist_probe.py` — what does a mid-roll look like?

Pure HTTP, no player. Polls the live media playlist and logs every tag,
reporting anything it does not recognise.

```bash
./probe/playlist_probe.py caedrel
./probe/playlist_probe.py caedrel --quality 480p30 --out probe/run1.ndjson
```

The main README claims ads are marked `#EXT-X-DATERANGE` with
`CLASS="twitch-stitched-ad"`. **That is unverified.** This script deliberately
does not assume it — it flags `EXT-X-CUE-OUT`/`CUE-IN`, `SCTE35`,
`DISCONTINUITY` and any unknown tag, so the real marker surfaces whatever its
shape turns out to be. Confirming or killing that claim is half the point.

### `seek_probe.lua` + `run_probe.sh` — does the seek recover?

```bash
./probe/run_probe.sh caedrel
```

Launches the stream into mpv with a 2 GiB disk-backed rewind buffer and
attaches the probe. Keys (these override mpv defaults for the session):

| key | action |
|---|---|
| `b` | pause 180s to fall behind live, then auto-resume |
| `k` | seek **+30s** — the actual test |
| `j` | seek −30s |
| `y` | print cache/seek window state |

It measures recovery from mpv's `playback-restart` event, which fires when
decoding genuinely resumes — not from guessing that `time-pos` moved. It also
logs `paused-for-cache` stalls and any `video-params` change, since a
resolution or pixel-format switch is the fingerprint of a discontinuity.

## Running the test

Two terminals.

**1 —** start the playlist probe and leave it. It tells you when an ad break
begins and ends:

```bash
./probe/playlist_probe.py caedrel
```

**2 —** start playback, then immediately press `b`. You are now ~3 minutes
behind live, with the ad break landing in your buffer rather than on screen:

```bash
./probe/run_probe.sh caedrel
```

**3 —** wait for terminal 1 to print `>>> AD BREAK START`. Keep watching
normally — you are behind, so the ad has not reached you yet.

**4 —** when playback reaches the ad, press `k` to skip over it. Press it
twice if the break is longer than 30s.

**5 —** read the result:

```bash
grep -E 'SEEK|STALL|PARAMS' "$(wslpath -u "$(powershell.exe -NoProfile -Command 'Write-Output $env:LOCALAPPDATA' | tr -d '\r')")/Temp/slipstream-probe/seek-events.log"
```

## Interpreting it

| Outcome | Meaning |
|---|---|
| `SEEK RECOVERED in <1000 ms` | Strategy works. Build it. |
| `SEEK RECOVERED` but 2–10s, or `STALL` either side | Works, but skipping costs a visible freeze. Needs a pre-buffer or a re-seek retry before it is acceptable. |
| `SEEK DID NOT RECOVER within 10s` | **Strategy is dead.** Do not build ad-skip on a DVR seek. Fall back to auto-mute over the ad window. |

A `VIDEO PARAMS CHANGED` line near the boundary confirms the ad was encoded
differently from the content, which is the likeliest cause if seeking is slow.

Also worth checking in `seek-samples.csv`: does `seekable_start`/`seekable_end`
widen the way the capacity table in the main README predicts? That validates
open question #3 (whether `--cache-on-disk` holds up over a long session) for
free, from the same run.

## Caveats

- Ads are not on demand. Caedrel runs ~2 per match, so budget a real session.
- This is throwaway diagnostic code, not a foundation. Once the questions are
  answered, the answers belong in the README and these can go.
- `run_probe.sh` resolves every path at runtime and stages the Lua script into
  `%LOCALAPPDATA%\Temp\slipstream-probe` — mpv is a Windows binary and cannot
  reliably load a script over `\\wsl.localhost`.
