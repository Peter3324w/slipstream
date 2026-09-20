#!/usr/bin/env bash
# Launch a stream into mpv with a large disk-backed rewind buffer and the
# seek probe attached. See probe/README.md for the test sequence.
#
#   ./probe/run_probe.sh caedrel
#   ./probe/run_probe.sh caedrel 480p30
#
# Paths are resolved at runtime - nothing machine-specific is committed.
# Override with SLIPSTREAM_MPV / SLIPSTREAM_STREAMLINK if yours differ.

set -euo pipefail

CHANNEL="${1:-}"
QUALITY="${2:-best}"
if [ -z "$CHANNEL" ]; then
    echo "usage: $0 <channel> [quality]" >&2
    exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

WINLOCAL="$(powershell.exe -NoProfile -Command 'Write-Output $env:LOCALAPPDATA' 2>/dev/null | tr -d '\r')"
if [ -z "$WINLOCAL" ]; then
    echo "could not resolve %LOCALAPPDATA% - is WSL interop enabled?" >&2
    exit 1
fi

PROBE_W="${WINLOCAL}\\Temp\\slipstream-probe"
PROBE_U="$(wslpath -u "$WINLOCAL")/Temp/slipstream-probe"
mkdir -p "$PROBE_U"

# mpv is a Windows binary; a \\wsl.localhost script path is unreliable, so stage it.
cp "$HERE/seek_probe.lua" "$PROBE_U/"

MPV_W="${SLIPSTREAM_MPV:-C:\\Program Files\\MPV Player\\mpv.exe}"
SL_W="${SLIPSTREAM_STREAMLINK:-${WINLOCAL}\\Programs\\Streamlink\\bin\\streamlink.exe}"
BACK="${SLIPSTREAM_BACK_BYTES:-2GiB}"
FWD="${SLIPSTREAM_FWD_BYTES:-256MiB}"
SEEK="${SLIPSTREAM_SEEK_SECS:-30}"
DELAY="${SLIPSTREAM_DELAY_SECS:-180}"

cat <<INFO
channel   : ${CHANNEL} (${QUALITY})
mpv       : ${MPV_W}
back-buf  : ${BACK} on disk
logs      : ${PROBE_W}

  b = build ${DELAY}s delay    k = seek +${SEEK}s    j = seek -${SEEK}s    y = info

INFO

# Generated rather than inlined: quoting through bash -> powershell ->
# streamlink -> mpv is otherwise unmanageable.
cat > "${PROBE_U}/run.ps1" <<PS
\$ErrorActionPreference = 'Continue'
\$env:SLIPSTREAM_PROBE_DIR  = '${PROBE_W}'
\$env:SLIPSTREAM_SEEK_SECS  = '${SEEK}'
\$env:SLIPSTREAM_DELAY_SECS = '${DELAY}'

\$playerArgs = @(
    '--hwdec=auto-safe'
    '--force-seekable=yes'
    '--cache=yes'
    '--cache-on-disk=yes'
    '--demuxer-max-back-bytes=${BACK}'
    '--demuxer-max-bytes=${FWD}'
    '--script=${PROBE_W}\seek_probe.lua'
    '--log-file=${PROBE_W}\mpv.log'
    '--msg-level=all=info'
    '--keep-open=no'
    '{playerinput}'
) -join ' '

& '${SL_W}' --player '${MPV_W}' --player-args \$playerArgs 'twitch.tv/${CHANNEL}' '${QUALITY}'
PS

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${PROBE_W}\\run.ps1"

echo
echo "session over. results:"
echo "  events  : ${PROBE_U}/seek-events.log"
echo "  samples : ${PROBE_U}/seek-samples.csv"
echo "  mpv log : ${PROBE_U}/mpv.log"
echo
echo "grep -E 'SEEK|STALL|PARAMS' '${PROBE_U}/seek-events.log'"
