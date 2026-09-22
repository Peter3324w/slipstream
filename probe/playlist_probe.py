#!/usr/bin/env python3
"""
Playlist probe - answers the first half of open question #4.

What does a Twitch stitched mid-roll ACTUALLY look like in the HLS playlist?

The README claims ads are marked with `#EXT-X-DATERANGE` carrying
CLASS="twitch-stitched-ad". That claim is unverified. This script does not
assume it: it logs every tag it sees and reports anything unrecognised, so
the real marker surfaces whatever its format turns out to be.

Run this against a live channel and leave it going until a mid-roll happens.

    ./probe/playlist_probe.py caedrel
    ./probe/playlist_probe.py caedrel --quality 480p30 --out probe/run1.ndjson

Stdlib only. Safe to run unattended - it reads a playlist, nothing more.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

# Tags that appear on every poll and carry no boundary information.
# Anything NOT in here gets reported the first time it is seen.
BORING = {
    "EXTM3U", "EXTINF", "EXT-X-VERSION", "EXT-X-TARGETDURATION",
    "EXT-X-MEDIA-SEQUENCE", "EXT-X-PROGRAM-DATE-TIME", "EXT-X-ENDLIST",
    "EXT-X-TWITCH-ELAPSED-SECS", "EXT-X-TWITCH-TOTAL-SECS",
    "EXT-X-TWITCH-LIVE-SEQUENCE", "EXT-X-TWITCH-INFO",
    # Low-latency prefetch hint. Appears on every poll and means nothing here.
    "EXT-X-TWITCH-PREFETCH",
}

# Tags that plausibly delimit an ad break. We flag all of them and let the
# evidence decide which one Twitch is actually using.
BOUNDARY = {
    "EXT-X-DATERANGE", "EXT-X-DISCONTINUITY", "EXT-X-DISCONTINUITY-SEQUENCE",
    "EXT-X-CUE-OUT", "EXT-X-CUE-OUT-CONT", "EXT-X-CUE-IN", "EXT-X-SCTE35",
    "EXT-X-ASSET", "EXT-X-SPLICEPOINT-SCTE35",
}

# Long enough to ride out a routing blip, short enough to notice a dead stream.
MAX_RESOLVE_FAILURES = 8

ATTR_RE = re.compile(r'([A-Za-z0-9-]+)=("[^"]*"|[^,]*)')
TAG_RE = re.compile(r'^#(EXT[A-Z0-9-]*)(?::(.*))?$')

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def streamlink_bin():
    """Locate streamlink without hardcoding a username."""
    override = os.environ.get("STREAMLINK_BIN")
    if override:
        return override
    lad = os.environ.get("LOCALAPPDATA")
    if not lad:
        try:
            lad = subprocess.run(
                ["powershell.exe", "-NoProfile", "-Command", "Write-Output $env:LOCALAPPDATA"],
                capture_output=True, text=True, timeout=30,
            ).stdout.strip()
        except Exception:
            lad = ""
    if lad:
        wsl = subprocess.run(["wslpath", "-u", lad], capture_output=True, text=True).stdout.strip()
        cand = os.path.join(wsl, "Programs", "Streamlink", "bin", "streamlink.exe")
        if os.path.exists(cand):
            return cand
    return "streamlink"


def resolve_stream_url(channel, quality):
    """Ask streamlink for the media playlist URL. This is the piece not worth
    reimplementing - it handles Twitch's access-token dance."""
    url = channel if "://" in channel or "." in channel.split("/")[0] else f"twitch.tv/{channel}"
    cmd = [streamlink_bin(), "--stream-url", url, quality]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    out = (p.stdout or "").strip()
    if not out.startswith("http"):
        raise RuntimeError(f"streamlink could not resolve a URL.\n{p.stdout}\n{p.stderr}")
    return out


def fetch(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def parse_attrs(s):
    out = {}
    for k, v in ATTR_RE.findall(s or ""):
        out[k] = v[1:-1] if v.startswith('"') else v
    return out


def parse(text):
    """Return (tags, segments). tags is a list of (name, raw_attr_string)."""
    tags, segs = [], []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            m = TAG_RE.match(line)
            if m:
                tags.append((m.group(1), m.group(2) or ""))
        else:
            segs.append(line)
    return tags, segs


def follow_master_if_needed(url, text):
    """--stream-url usually yields a media playlist, but handle a master."""
    if "#EXT-X-STREAM-INF" not in text:
        return url, text
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            nxt = urllib.parse.urljoin(url, line) if "://" not in line else line
            return nxt, fetch(nxt)
    return url, text


def main():
    ap = argparse.ArgumentParser(description="Log Twitch HLS playlist tags to find ad boundaries.")
    ap.add_argument("channel", help="channel name, or a full twitch.tv/... URL")
    ap.add_argument("--quality", default="best")
    ap.add_argument("--interval", type=float, default=2.0, help="poll seconds (segments are ~2s)")
    ap.add_argument("--out", default=None, help="NDJSON log path")
    args = ap.parse_args()

    out_path = args.out or f"probe/playlist-{int(time.time())}.ndjson"
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    log = open(out_path, "a", buffering=1, encoding="utf-8")

    def emit(kind, **kw):
        rec = {"ts": now(), "event": kind, **kw}
        log.write(json.dumps(rec) + "\n")
        return rec

    print(f"resolving {args.channel} ({args.quality}) ...", file=sys.stderr)
    url = resolve_stream_url(args.channel, args.quality)
    print(f"playlist  : {url.split('?')[0]}", file=sys.stderr)
    print(f"logging   : {out_path}", file=sys.stderr)
    print("watching for ad boundaries - leave this running until a mid-roll hits.\n", file=sys.stderr)
    emit("start", channel=args.channel, quality=args.quality)

    seen_tags = set()
    seen_segs = set()
    in_ad = False
    ad_started = None
    polls = 0
    discontinuities = 0
    resolve_failures = 0
    seen_dateranges: set[str] = set()

    while True:
        try:
            text = fetch(url)
            polls += 1
        except urllib.error.HTTPError as e:
            # The signed URL expires; re-resolve rather than dying.
            print(f"[{now()}] playlist HTTP {e.code} - re-resolving", file=sys.stderr)
            emit("reresolve", code=e.code)
            try:
                url = resolve_stream_url(args.channel, args.quality)
                resolve_failures = 0
            except Exception as ex:
                # One timed-out re-resolve is not a reason to abandon a probe
                # that has to run for hours. This network drops usher.ttvnw.net
                # intermittently, and giving up loses the whole session.
                resolve_failures += 1
                emit("reresolve_failed", error=str(ex), consecutive=resolve_failures)
                if resolve_failures >= MAX_RESOLVE_FAILURES:
                    emit("fatal", error=str(ex))
                    print(f"gave up after {resolve_failures} failed re-resolves: {ex}",
                          file=sys.stderr)
                    return 1
                wait = min(60, 5 * resolve_failures)
                print(f"[{now()}] re-resolve failed "
                      f"({resolve_failures}/{MAX_RESOLVE_FAILURES}), retrying in {wait}s",
                      file=sys.stderr)
                time.sleep(wait)
            continue
        except Exception as e:
            emit("fetch_error", error=str(e))
            time.sleep(args.interval)
            continue

        tags, segs = parse(text)

        new_segs = [s for s in segs if s not in seen_segs]
        seen_segs.update(segs)
        if len(seen_segs) > 5000:
            seen_segs = set(segs)

        for name, attrs in tags:
            # Report any tag we have never seen before, boring or not.
            if name not in seen_tags:
                seen_tags.add(name)
                if name not in BORING:
                    rec = emit("new_tag", tag=name, attrs=attrs, parsed=parse_attrs(attrs))
                    print(f"[{rec['ts']}] NEW TAG  #{name}:{attrs}", flush=True)

            if name not in BOUNDARY:
                continue

            a = parse_attrs(attrs)

            if name == "EXT-X-DISCONTINUITY":
                discontinuities += 1
                emit("discontinuity", count=discontinuities)
                print(f"[{now()}] DISCONTINUITY (#{discontinuities}) "
                      f"- decoder may re-init here", flush=True)

            elif name == "EXT-X-DATERANGE":
                cls = a.get("CLASS", "")
                # Twitch's session/timestamp ranges carry END-ON-NEXT=YES and so
                # reappear in every single playlist. Reporting them each poll
                # buries the one range that matters under thousands of lines.
                if attrs in seen_dateranges:
                    continue
                seen_dateranges.add(attrs)
                emit("daterange", **a)
                looks_like_ad = "ad" in cls.lower() or "AD" in a.get("ID", "").upper()
                mark = "AD MARKER" if looks_like_ad else "daterange"
                print(f"[{now()}] {mark}  CLASS={cls!r} ID={a.get('ID','')!r} "
                      f"DURATION={a.get('DURATION','?')} START={a.get('START-DATE','?')}", flush=True)
                if looks_like_ad and not in_ad:
                    in_ad, ad_started = True, time.time()

            elif name in ("EXT-X-CUE-OUT", "EXT-X-SPLICEPOINT-SCTE35", "EXT-X-SCTE35"):
                if not in_ad:
                    in_ad, ad_started = True, time.time()
                    emit("ad_start", via=name, attrs=attrs)
                    print(f"[{now()}] >>> AD BREAK START  (via #{name}) {attrs}", flush=True)

            elif name == "EXT-X-CUE-IN":
                if in_ad:
                    dur = time.time() - (ad_started or time.time())
                    emit("ad_end", via=name, observed_seconds=round(dur, 1))
                    print(f"[{now()}] <<< AD BREAK END    observed {dur:.1f}s\n", flush=True)
                    in_ad, ad_started = False, None

        if polls % 30 == 0:
            state = "IN AD BREAK" if in_ad else "content"
            print(f"[{now()}] ... {polls} polls, {len(seen_segs)} segments, "
                  f"{discontinuities} discontinuities, now: {state}", flush=True)
            emit("heartbeat", polls=polls, discontinuities=discontinuities, in_ad=in_ad)

        time.sleep(args.interval)


if __name__ == "__main__":
    import urllib.parse  # noqa: E402  (used by follow_master_if_needed)
    try:
        sys.exit(main() or 0)
    except KeyboardInterrupt:
        print("\nstopped.", file=sys.stderr)
