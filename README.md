# Slipstream

A lightweight desktop Twitch client. Video and chat in one window, without the web app's overhead.

Wraps [streamlink](https://streamlink.github.io/) for stream resolution and [mpv](https://mpv.io/) for playback. Not affiliated with, endorsed by, or connected to Twitch Interactive, Inc.

---

## Why

This started as a measurement, not an idea. Microsoft Edge with a **single** Twitch tab open, on an i7-7500U / 11.9GB laptop:

```
12272    988MB  renderer          <- the Twitch tab
8652     277MB  browser (main)
3828     250MB  gpu-process
2864     156MB  renderer          <- not a tab anyone opened
15040     75MB  renderer          <- "
6564      87MB  renderer          <- "
6948      65MB  renderer          <- "
9844      36MB  renderer          <- "
4892      53MB  utility  video_capture
12056     56MB  utility  network
14152     30MB  utility  edge_search_indexer
...                                 ~2.06 GB total, 21.7% CPU
```

The instructive part is what this *isn't*. Hardware video decode was already working — Task Manager showed `GPU 0 - Video Processing` active, and the HD 620 exposes `h264-d3d11va`. **The video was never the problem.**

The cost was everything around it: a React app, a chat pane that mutates the DOM continuously, ad logic, telemetry, and a renderer that had leaked to 988MB over a long session. Plus five renderer processes for one tab, because the browser ships a sidebar, a preloaded new-tab page and spare renderers regardless.

So the goal is not "escape the browser's video pipeline." It is **"don't ship Twitch's chat and ad stack."** That framing decides most of what follows.

### Target

Under 300MB resident with video and chat running. Roughly a **7x** reduction. Measured the same way — per-process, not a single summary number.

---

## Architecture

`streamlink` does the hard part: Twitch's access-token dance and HLS playlist resolution. That is the piece not worth reimplementing. Everything downstream is ours.

**v1 is Path A — hls.js into a plain `<video>`.** Decided 2026-09-21. Path B is not dead; it is
gated on the seek probe in [`probe/`](probe/). See the open questions.

### How playback is wired

```
streamlink --json twitch.tv/<channel>            (main process)
        |
        +-- metadata: id, author, title, category
        +-- streams[*].master : the usher master playlist URL
                 |
        main fetches the master body              <- Node, so no CORS
                 |
        renderer wraps it in a Blob  ->  hls.js  ->  <video>
                                                        |
                                            Chromium hardware-decodes
```

**Why the master crosses the IPC boundary as text and not as a URL.** Measured against a live
channel, 2026-09-21:

| | `access-control-allow-origin` |
|---|---|
| `usher.ttvnw.net` — master playlist | **absent** |
| `*.playlist.ttvnw.net` — media playlists | `*` |
| `*.hls.ttvnw.net` — segments | `*` |

So the renderer cannot fetch the master, but it can fetch everything the master points at. And
every URI inside a Twitch manifest is absolute, so there is no base-URL to resolve against. Main
fetches the manifest once and passes the body; hls.js loads it from a Blob and every request after
that goes direct. No proxy, no rewriting of security headers, no custom protocol handler.

**Why Electron and not Tauri.** Tauri's headline win is binary size. Its WebView2 runtime is still
a Chromium renderer, so the memory difference is perhaps 50MB — not the difference between passing
and failing a 300MB target. Electron is also the stack PlayTime already holds ~100MB on.

### What Path A costs

The back buffer lives in MSE SourceBuffers, in RAM, under a Chromium quota. `BACK_BUFFER_SECONDS`
is 120 — roughly two minutes of rewind. Enough to scrub back over a teamfight. **Not** enough to
sit out a three-minute ad break, which is exactly why Path B still matters.

### Path B — mpv, embedded (deferred)

```
streamlink ... -o -   ->   mpv (--wid=<HWND> from getNativeWindowHandle())
```

- **Pro:** a real DVR. `--cache-on-disk=yes` puts the rewind buffer on disk instead of RAM, which
  is the whole ballgame on an 11.9GB machine — and it is what makes ad-skipping possible at all.
- **Con:** mpv renders to its own surface, so HTML will not composite above the video. The video
  region needs its own frameless window, which means a second renderer process for a pane that
  draws nothing. Control it over IPC (`--input-ipc-server`, a named pipe on Windows).


---

## Rewind / DVR

Worth its own section, because it solves a second problem for free. **Everything below describes
Path B** — it is what a disk-backed buffer buys. Path A's rewind is the two minutes noted above.

`--demuxer-max-back-bytes` *is* the rewind buffer. Verified present in mpv `v0.41.0-244-gaf9c81fa1`:

```
--force-seekable=yes            # streamlink pipes an unseekable stream; override it
--demuxer-max-back-bytes=2GiB   # how far back you can scrub  (default: 50 MiB)
--cache-on-disk=yes             # buffer to disk, not RAM     (default: no)
--cache=yes
```

Capacity at Twitch bitrates:

| Buffer | 720p60 (~3.5 Mbps) | 1080p60 (~6 Mbps) |
|---|---|---|
| 50 MiB (default) | ~2 min | ~1 min |
| 1 GiB | ~40 min | ~23 min |
| 2 GiB | ~80 min | ~45 min |

**Limitation:** the buffer starts when you press play. You cannot rewind to before you tuned in. Twitch's server-side DVR can, and that is a genuine advantage of theirs.

**Workaround for archived channels:** the VOD exists *while the stream is still live*. Resolving `twitch.tv/videos/<id>` for an in-progress broadcast gives a "watch from the start" path — a different code path, the same user-facing feature. *(Unverified — confirm with a live archived channel.)*

---

## Ads

Neither streamlink nor mpv blocks ads, and the project should not pretend otherwise.

Evidence, straight from a debug run — this is the decoded access token Twitch returns:

```
[plugins.twitch][debug] {'adblock': False, 'geoblock_reason': '', 'hide_ads': False,
                         'server_ads': True, 'show_ads': True}
```

Twitch states the ad policy; streamlink receives it and does nothing about it. With Turbo or a channel sub, `hide_ads` returns `True` — that is the sanctioned switch, and it is server-side.

There *is* a real partial effect worth understanding:

- **Pre-rolls** are served by the web player's JavaScript. streamlink never loads twitch.tv, so they never fire. Genuinely skipped, as a side effect of not being a browser.
- **Mid-rolls** are stitched into the HLS stream server-side (SSAI). They arrive as ordinary segments and play like any other video.

`--twitch-disable-ads` was removed upstream (absent in 8.6.1). It never blocked ads at the network level — it dropped segments marked as ads, leaving a gap. Once ads were stitched into the main stream, the approach stopped working and was removed rather than shipped half-broken.

### Our stance

**Watch on delay and seek past them.** With a rewind buffer built up, a stitched mid-roll is just video you fast-forward over — you spend buffer instead of watching the ad. No proxy, no circumvention, nothing against the Developer Agreement, nothing that breaks when Twitch adjusts.

This falls out of the DVR feature we wanted anyway. It is the reason Path B looks attractive.

Detect ad boundaries via the HLS `#EXT-X-DATERANGE` tag carrying `CLASS="twitch-stitched-ad"` to drive auto-skip or auto-mute. *(Unverified — confirm against a live playlist during a mid-roll.)*

---

## Scope

### v1 — prove the thesis

- [x] Channel input and quality picker, both from a single `streamlink --json` call
- [x] Playback through hls.js
- [x] **Anonymous chat**, read-only — a `justinfan` nick needs no account
- [x] First-party emotes — the IRC `emotes` tag carries id and range, so this came almost free
- [x] Per-process memory readout in-app (`F2`), because one summary number is exactly what hid the
      problem in the browser
- [ ] **Run it against a long live session and write the number down**

Still deliberately no login and no third-party emotes. v1 exists to answer one question: does this
actually come in under 300MB?

### v2 — make it a real client

- [ ] Twitch login via **Device Code Flow** (`https://id.twitch.tv/oauth2/device`) — public client, no secret, no localhost redirect server. Scopes: `chat:read chat:edit user:read:follows`
- [ ] Followed-channels list, live status — Helix `/streams/followed`. This is what makes it feel like a client rather than a launcher
- [ ] Send chat messages
- [ ] Third-party emotes (see below)
- [ ] DVR controls: scrub bar, configurable buffer, ad-skip

### Later

- [ ] VOD downloader — `streamlink --output vod.ts twitch.tv/videos/<id> best`. Clip ranges with `--hls-start-offset` / `--hls-duration`. Remux with the ffmpeg streamlink already bundles
- [ ] Multi-stream / picture-in-picture
- [ ] Per-channel buffer and quality defaults

### Non-goals

- **Ad blocking via proxies.** Fragile, dependent on someone else's infrastructure, against the Developer Agreement. The delay-and-skip approach is better and stable.
- **Loading the actual 7TV browser extension.** It injects into twitch.tv's DOM. There is no twitch.tv DOM here. Reimplement against the API instead.
- **Replacing Twitch.** No clips, no channel points, no raids, no mod tools. Watch streams, read chat, leave.

---

## Third-party emotes

Not "add the 7TV extension" — implement the APIs directly. Each returns name -> image URL; the chat renderer tokenizes a message and swaps matching words for `<img>`. The on/off toggle is free, because it is our own code.

```
7TV   https://7tv.io/v3/users/twitch/{twitch_user_id}
BTTV  https://api.betterttv.net/3/cached/users/twitch/{id}
FFZ   https://api.frankerfacez.com/v1/room/id/{id}
```

*(All three unverified in-session — confirm response shapes before building against them.)*

> **Performance trap.** 7TV emotes are animated WebP. A fast chat rendering hundreds of independently-animating images is *precisely* what made the browser's chat expensive. Cap concurrent animations or render static first frames until hover. Get this wrong and the project rebuilds the problem it exists to escape.

---

## Dependencies

Both installed via `winget`. Neither is vendored; the app shells out.

| | Version | Path |
|---|---|---|
| streamlink | 8.6.1 | `%LOCALAPPDATA%\Programs\Streamlink\bin\streamlink.exe` (on PATH) |
| mpv | v0.41.0 | `C:\Program Files\MPV Player\mpv.exe` (**not** on PATH — reference by full path) |
| ffmpeg | bundled | `%LOCALAPPDATA%\Programs\Streamlink\ffmpeg\ffmpeg.exe` |

```
winget install --id Streamlink.Streamlink --source winget
winget install --id shinchiro.mpv --source winget
```

### Gotchas, learned the hard way

- **mpv's `--hwdec` defaults to off.** Without `--hwdec=auto-safe`, mpv software-decodes H.264 and uses *more* CPU than the browser it replaced. Never drop this flag.
- **Twitch quality names vary per channel.** One channel offers `480p30` and `720p60`; the framerate suffix is inconsistent. Do not hardcode names — use `best` with `--stream-sorting-excludes=">720p"` to cap quality, or read the real list from `--json`.
- **An unknown option makes streamlink refuse to start.** Validate flags against the installed build, not against documentation or memory.

### Useful streamlink Twitch options (8.6.1)

```
--twitch-low-latency
--twitch-supported-codecs CODECS
--twitch-api-header KEY=VALUE
--twitch-access-token-param KEY=VALUE
--twitch-force-client-integrity
--twitch-purge-client-integrity
```

---

## Development

```
npm install
npm run dev        # electron-vite: HMR for the renderer, auto-restart for main
npm run build      # typecheck both projects, then bundle to out/
npm run typecheck
```

Requires Node 22+ (Electron 44's floor) and streamlink on PATH. Press `F2` in the running app for
the per-process memory readout.

### Toolchain gotchas, learned the hard way

- **Electron 44 has no postinstall.** It downloads its binary lazily on first use, so a clean
  `npm install` finishing successfully does not mean you can run anything yet.
- **npm 11 blocks install scripts by default.** `npm approve-scripts <pkg>` is now a required step;
  esbuild silently has no binary otherwise.
- **electron-vite does not minify.** The renderer bundle was 1,957kB of readable, commented
  JavaScript until `build.minify` was set explicitly — 613kB after, with hls.js on its `light`
  build (no DRM, no subtitles, no alternate audio; Twitch needs none of them). For a project whose
  whole claim is a memory number, parsing and JITing 52,000 lines at every launch is not a neutral
  default.
- **TypeScript 6 removed `baseUrl`.** Path aliases have to be relative now: `["./src/shared/*"]`.
- **If `electron-v*.zip` downloads at 0 B/s**, the release asset CDN is unreachable, not the
  network. Point Electron at a mirror:
  ```
  set "ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/"
  set "ELECTRON_CUSTOM_DIR={{ version }}"
  ```


## Chat protocol

Twitch IRC over WebSocket. **Reading requires no authentication:**

```
wss://irc-ws.chat.twitch.tv:443
NICK justinfan12345        # any justinfan + digits; anonymous, read-only
JOIN #<channel>
```

Sending uses the same socket with an OAuth token and `chat:edit`. Request the `tags` capability for badges, colours and emote positions. *(Unverified in-session.)*

---

## Prior art

Read these before building. Both are mature and occupy adjacent space.

- **Streamlink Twitch GUI** (`Streamlink.Streamlink.TwitchGui` in winget) — browse channels, launch streams into a player. Closest existing thing to this idea.
- **Chatterino** — native C++/Qt Twitch chat, very light, full 7TV/BTTV/FFZ support. Best-in-class for the chat half.

Chatterino + streamlink *is* the lightweight Twitch setup people already run. **Our gap: neither combines video and chat in one tuned window, and neither has a disk-backed DVR.** That is the thing worth building. If a prototype does not beat that pair, the honest move is to use that pair.

---

## Open questions

1. ~~Path A or Path B?~~ **Path A for v1**, decided on CORS behaviour and process count rather
   than on a measurement — a second frameless window for mpv would add a renderer process that
   draws nothing. The RAM number itself is still unmeasured, so this is a decision, not an answer.
2. How badly does `--wid` embedding constrain overlays in practice? (Path B only.)
3. Does `--cache-on-disk` hold up over a multi-hour session, or does the cache file grow unbounded?
4. Does seeking forward past a stitched mid-roll actually work, or does the demuxer stall at
   the ad boundary? **The whole ad strategy rests on this.** Instrumented in [`probe/`](probe/)
   — run that before writing any application code.
5. ~~Electron or Tauri?~~ **Electron.** Tauri's footprint claim is mostly about binary size;
   WebView2 is still a Chromium renderer. Revisit only if the measured number misses badly.

---

## Legal

Third-party Twitch clients sit in a grey area of the Twitch Developer Agreement. Chatterino and similar are long-tolerated. Ad circumvention specifically is not, which is a further reason the delay-and-skip approach is the right call. Fine as a personal tool and a portfolio piece; think harder before any storefront.
