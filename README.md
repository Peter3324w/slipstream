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
- [x] **Close vs hide chat.** Hiding takes it off screen; the socket stays up, so the log is
      current when it comes back and you pay for it the whole time. Closing drops the connection
      and frees the message nodes. The header shows bytes received, so the difference is a number
      rather than a claim. Closed is remembered across restarts, because it is a choice about data
      — and reconnecting starts from an empty log, since Twitch sends no backlog
- [ ] **Run it against a long live session and write the number down**

Still deliberately no login and no third-party emotes. v1 exists to answer one question: does this
actually come in under 300MB?

### v2 — make it a real client

- [x] Twitch login via **Device Code Flow** — public client, no secret, no localhost redirect server
- [ ] Followed-channels list, live status — Helix `/streams/followed`. This is what makes it feel like a client rather than a launcher
- [x] Send chat messages
- [x] Third-party emotes — 7TV, BTTV and FFZ, each switchable on its own
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

Not "add the 7TV extension" — implement the APIs directly. Each returns name -> image URL; the
chat renderer tokenises a message and swaps matching words for `<img>`. The toggles are free,
because it is our own code.

**All three implemented and verified (2026-09-21.)**

```
7TV    https://7tv.io/v3/emote-sets/global
       https://7tv.io/v3/users/twitch/{twitch_user_id}
BTTV   https://api.betterttv.net/3/cached/emotes/global
       https://api.betterttv.net/3/cached/users/twitch/{twitch_user_id}
FFZ    https://api.frankerfacez.com/v1/set/global        (honour `default_sets`)
       https://api.frankerfacez.com/v1/room/id/{twitch_user_id}
```

All three key on Twitch's **numeric user id**, which `streamlink --json` does not return — its
`metadata.id` is the *stream* id. It comes from the same GQL `UseLive` query already used to tell a
typo from an offline channel.

Typical yield, after merging (globals first, then channel sets, so a channel reusing a global name
wins):

| channel | 7TV | BTTV | FFZ |
|---|---|---|---|
| Caedrel | 1029 | 109 | 39 |
| lirik | 1018 | 112 | 33 |

### Formats are chosen per provider, on measurements

Not a house style — the right answer differs, and in one case inverts.

**7TV — take AVIF.** 1x AVIF is 28KB against 72KB for the same emote as WebP, and *every* emote
checked had one (1003/1003, 1041/1041). WebP is a per-image fallback on a decode error rather than
a capability probe: letting the decoder answer is simpler and cannot be wrong.

**BTTV — take GIF, but only for animated ones.** BTTV content-negotiates on `Accept`, so an `<img>`
element silently gets WebP. For animated emotes that is a bad deal:

| emote | what a browser gets (WebP) | GIF |
|---|---|---|
| SourPls | 920 KB | **296 KB** |
| FeelsRainMan | 34 KB | **9 KB** |
| nymnCorn | 19 KB | **4 KB** |
| PepePls | 28 KB | **8 KB** |

Median across eight animated emotes: WebP is about **3x** the GIF. For *static* BTTV emotes the
ordering flips and WebP wins, so those keep it. Note that requesting `.png` on an animated emote
returns a single still frame — tiny, but not the emote. That is a trap when comparing sizes, and a
possible basis for a future "static emotes" mode.

**FFZ — take what it gives.** It rejects format suffixes with a 400. Animated emotes carry a
separate `animated` URL map (WebP); the plain `urls` map is PNG. No `content-length`, so sizes are
not measurable by HEAD.

### Cost, and why the switch is per provider

| | |
|---|---|
| 7TV channel index, raw JSON | **2.38 MB** |
| ...as served (zstd) | **287 KB** |
| Cold fetch | ~5.4 s |
| From the 24h disk cache | **455 ms** |

BTTV and FFZ indexes are a few hundred emotes between them and cost almost nothing. So the
providers are switched **individually**: on a bad line, dropping 7TV while keeping BTTV and FFZ is a
real choice rather than a preference. Off means off — no index fetch, no images, names render as
plain text. Messages already on screen keep what they downloaded, because stripping them out
reclaims nothing. The chat header shows bytes downloaded, so the cost is a number and not a claim.

> **Cache schema.** Cached entries carry a version. Adding the `provider` field without one left
> day-old cache files silently missing it — a channel contributed 1029 emotes and *none* survived
> the merge, on one channel but not another, purely because one was cached and one was not.

> **Performance trap.** Most third-party emotes are animated, and a fast chat rendering hundreds of
> independently-animating images is *precisely* what made the browser's chat expensive. Mitigated
> here by 1x images, the format choices above, `loading="lazy"`, and intrinsic `width`/`height`
> where the provider reports them. **Not yet mitigated: how many animate at once.** Roughly two
> thirds of a 7TV channel set is animated. Capping concurrent animations, or holding a first frame
> until hover, is still open.

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
- **`electron-vite dev` does not watch main or preload without `--watch`.** The renderer
  hot-reloads either way, so the app looks alive while main and the preload script sit at whatever
  they were when it launched. The failure is nasty precisely because it is half-working: the
  renderer had hot-reloaded to code calling `window.slipstream.auth`, against a preload built
  before auth existed. `npm run dev` passes `--watch`; do not remove it.
- **Remote debugging works, and is on in dev.** `app.commandLine.appendSwitch('remote-debugging-port', …)`
  is honoured, contrary to what an earlier commit message here claims — the one time it failed, the
  socket bind was refused (`WSAEACCES`) by an instance killed seconds earlier, not ignored. Point
  CDP at `127.0.0.1:9222` to drive the real UI, which is the only way to exercise anything behind
  the preload bridge.
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

Sending uses the same socket with an OAuth token and `chat:edit`. Request the `tags` capability for
badges, colours and emote positions.

*Verified 2026-09-21* against a live channel: the anonymous join works, and the `emotes` tag gives
`id:start-end` ranges that resolve to `static-cdn.jtvnw.net/emoticons/v2/<id>/default/dark/1.0`.
**The ranges are code point offsets, not UTF-16 indices** — index the string directly and every
message containing an emoji renders its emotes in the wrong place.

---

## Signing in

Device Code Flow (`https://id.twitch.tv/oauth2/device`). No client secret, no localhost redirect
server, no embedded browser asking for a password. You approve a short code on twitch.tv and the
app polls until it is granted.

Scopes: `chat:read chat:edit user:read:follows`.

### You need your own Client ID

Slipstream cannot ship one. A Client ID identifies a specific registered application, and this is a
public repository — so it is asked for on first use and kept out of the project entirely.

1. Open `dev.twitch.tv/console/apps` -> **Register Your Application**
2. Name it anything. **OAuth Redirect URLs**: `http://localhost` — the device flow never uses it,
   but the field is required
3. Category **Application Integration**, Client Type **Public**. Public is the part that matters:
   the device grant is refused for a confidential client
4. Copy the Client ID into the app's sign-in sheet

Stored in the app's user-data directory, or set `SLIPSTREAM_TWITCH_CLIENT_ID` to override.

### How the token is handled

- **Encrypted at rest** with Electron's `safeStorage` — DPAPI on Windows. If the platform offers no
  secure storage, the token stays in memory for the session and the app says so, rather than
  writing a bearer credential to disk in the clear. An access token is a password.
- **Not retained in the renderer.** The chat socket lives there, so the token has to cross IPC once
  per connect — it is fetched at that moment and thrown away, keeping the long-lived copy in main
  behind the keystore. Moving the IRC connection into main would remove the crossing entirely;
  noted, not done.
- **Refreshed early**, five minutes before expiry, so the first message after a long session does
  not fail. A refresh token Twitch declines drops the session outright: a credential that is
  silently dead is worse than none.
- **Revoked on sign out**, not merely deleted, so a recovered file cannot be replayed.

### What it does not do

Signing in does **not** remove ads. That is Turbo or a channel subscription, decided server side —
see the access-token payload under [Ads](#ads). Login buys sending messages and reading who you
follow, nothing more.

> Twitch answers the device grant with `{status, message}` rather than the RFC's `{error}`, so poll
> states (`authorization_pending`, `slow_down`, `expired_token`) arrive as the *message*. Both
> shapes are handled. `slow_down` widens the interval instead of retrying harder.


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
