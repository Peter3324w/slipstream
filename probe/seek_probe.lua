-- seek_probe.lua - answers the second half of open question #4.
--
--   When a stitched mid-roll is sitting in the rewind buffer and we seek
--   forward past it, does playback recover - or does the demuxer stall at
--   the discontinuity?
--
-- The whole ad strategy in README.md rests on the answer. If seeking past an
-- ad boundary stalls, "watch on delay and skip" does not work and the design
-- needs rethinking before any UI exists.
--
-- Runs inside mpv (--script=...) rather than over IPC: mpv is a Windows
-- binary and its named pipe is not reachable from WSL.
--
-- Keys:
--   b  build delay  - pause N seconds to fall behind live, then resume
--   k  seek forward - the actual test; measures recovery time
--   j  seek back
--   y  dump current cache/seek state
--
-- Note: k/j/b/y override mpv defaults for this session. That is deliberate.

local mp  = require 'mp'
local msg = require 'mp.msg'

local DIR   = os.getenv("SLIPSTREAM_PROBE_DIR") or "."
local SEP   = package.config:sub(1, 1)
local SEEK  = tonumber(os.getenv("SLIPSTREAM_SEEK_SECS")  or "") or 30
local DELAY = tonumber(os.getenv("SLIPSTREAM_DELAY_SECS") or "") or 180
local GIVEUP = 10 -- seconds before we call a seek failed

local function p(name) return DIR .. SEP .. name end

local ev  = io.open(p("seek-events.log"), "a")
local csv = io.open(p("seek-samples.csv"), "a")

local t0_session = mp.get_time()
local function stamp() return string.format("%8.3f", mp.get_time() - t0_session) end

local function logev(fmt, ...)
    local ok, body = pcall(string.format, fmt, ...)
    if not ok then body = fmt end
    local line = "[" .. stamp() .. "] " .. body
    if ev then ev:write(line, "\n"); ev:flush() end
    msg.info(body)
end

local function cache_state()
    return mp.get_property_native("demuxer-cache-state") or {}
end

local function window()
    local st = cache_state()
    return st["seekable-start"], st["seekable-end"]
end

-- ---------------------------------------------------------------- sampling

if csv then
    csv:write("# session start ", os.date("!%Y-%m-%dT%H:%M:%SZ"), "\n")
    csv:write("elapsed,time_pos,seekable_start,seekable_end,cache_duration,",
              "fw_bytes,total_bytes,paused_for_cache,frame_drops\n")
    csv:flush()
end

mp.add_periodic_timer(1, function()
    if not csv then return end
    local st = cache_state()
    csv:write(string.format("%.1f,%s,%s,%s,%s,%s,%s,%s,%s\n",
        mp.get_time() - t0_session,
        tostring(mp.get_property_number("time-pos") or ""),
        tostring(st["seekable-start"] or ""),
        tostring(st["seekable-end"] or ""),
        tostring(mp.get_property_number("demuxer-cache-duration") or ""),
        tostring(st["fw-bytes"] or ""),
        tostring(st["total-bytes"] or ""),
        tostring(mp.get_property_bool("paused-for-cache") and 1 or 0),
        tostring(mp.get_property_number("frame-drop-count") or "")))
    csv:flush()
end)

-- ------------------------------------------------------------ the test

local pending = nil

local function do_seek(amount)
    local pos = mp.get_property_number("time-pos")
    if not pos then
        logev("SEEK skipped - no time-pos yet")
        return
    end
    local ws, we = window()
    pending = { t0 = mp.get_time(), from = pos, amount = amount }
    logev("SEEK issued %+ds from %.1fs   [seekable %.1f .. %.1f]",
          amount, pos, ws or -1, we or -1)
    mp.osd_message(string.format("seek %+ds", amount), 2)
    mp.commandv("seek", tostring(amount), "relative+exact")
end

-- playback-restart fires once mpv has actually resumed decoding after a seek.
-- That is the precise signal we want, not a guess based on time-pos drifting.
mp.register_event("playback-restart", function()
    if not pending then return end
    local ms  = (mp.get_time() - pending.t0) * 1000
    local pos = mp.get_property_number("time-pos") or -1
    logev("SEEK RECOVERED in %.0f ms   (%.1fs -> %.1fs)  <-- seeking past the boundary WORKED",
          ms, pending.from, pos)
    mp.osd_message(string.format("recovered in %.0f ms", ms), 3)
    pending = nil
end)

-- If playback-restart never arrives, that is the failure case we are hunting.
mp.add_periodic_timer(0.5, function()
    if pending and (mp.get_time() - pending.t0) > GIVEUP then
        logev("SEEK DID NOT RECOVER within %ds  <-- demuxer appears STALLED at the boundary. "
              .. "If this happened across an ad, the delay-and-skip strategy does not work.", GIVEUP)
        mp.osd_message("SEEK STALLED - see seek-events.log", 5)
        pending = nil
    end
end)

-- ------------------------------------------------------------- detectors

local stall_t0 = nil
mp.observe_property("paused-for-cache", "bool", function(_, v)
    if v then
        stall_t0 = mp.get_time()
        logev("STALL start (paused-for-cache)")
    elseif stall_t0 then
        logev("STALL end after %.2fs", mp.get_time() - stall_t0)
        stall_t0 = nil
    end
end)

-- A resolution/format change means the decoder re-initialised, which is the
-- fingerprint of an HLS discontinuity - i.e. very likely an ad boundary.
local last_sig = nil
mp.observe_property("video-params", "native", function(_, v)
    if not v or not v.w then return end
    local sig = string.format("%dx%d %s", v.w, v.h, tostring(v.pixelformat))
    if sig ~= last_sig then
        if last_sig then
            logev("VIDEO PARAMS CHANGED %s -> %s   <-- decoder re-init, likely a content/ad boundary",
                  last_sig, sig)
        else
            logev("video params: %s", sig)
        end
        last_sig = sig
    end
end)

-- --------------------------------------------------------------- bindings

mp.add_key_binding("b", "slipstream-build-delay", function()
    logev("BUILD DELAY: pausing %ds to fall behind live", DELAY)
    mp.set_property_bool("pause", true)
    mp.osd_message(string.format("building %ds delay - buffer filling...", DELAY), 5)
    mp.add_timeout(DELAY, function()
        mp.set_property_bool("pause", false)
        local ws, we = window()
        logev("DELAY BUILT. seekable window %.1f .. %.1f  (%.1fs of rewind)",
              ws or -1, we or -1, (we and ws) and (we - ws) or -1)
        mp.osd_message("delay built - you are now behind live", 3)
    end)
end)

mp.add_key_binding("k", "slipstream-seek-fwd",  function() do_seek(SEEK)  end)
mp.add_key_binding("j", "slipstream-seek-back", function() do_seek(-SEEK) end)

mp.add_key_binding("y", "slipstream-info", function()
    local ws, we = window()
    local st = cache_state()
    local txt = string.format(
        "pos %.1fs | seekable %.1f..%.1f (%.0fs back) | cache %.0fs fwd | %.0f MiB on disk",
        mp.get_property_number("time-pos") or -1,
        ws or -1, we or -1,
        (ws and mp.get_property_number("time-pos")) and (mp.get_property_number("time-pos") - ws) or -1,
        mp.get_property_number("demuxer-cache-duration") or -1,
        (st["total-bytes"] or 0) / 1048576)
    logev("INFO %s", txt)
    mp.osd_message(txt, 5)
end)

logev("slipstream seek probe loaded | seek=%ds delay=%ds | logs -> %s", SEEK, DELAY, DIR)
logev("keys: b=build delay  k=seek +%ds  j=seek -%ds  y=info", SEEK, SEEK)
