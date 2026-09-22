#!/usr/bin/env bash
# One-line status for every playlist probe currently running.
#   ./probe/watch.sh [log-dir]      (default /tmp/slipprobe)
set -u
DIR="${1:-/tmp/slipprobe}"

printf '%-22s %-10s %-34s %s\n' CHANNEL UPTIME PROGRESS BOUNDARIES
for f in "$DIR"/*.log; do
  [ -e "$f" ] || { echo "no logs in $DIR"; exit 0; }
  name=$(basename "$f" .log)
  pid=$(ps -eo pid,args | awk -v n="$name" '$2 ~ /python3/ && index($0, n) && /playlist_probe/ {print $1; exit}')
  up=$([ -n "$pid" ] && ps -o etime= -p "$pid" | tr -d ' ' || echo "stopped")
  prog=$(grep -E '^\[.*\] \.\.\.' "$f" 2>/dev/null | tail -1 | sed 's/.*\.\.\. //')
  hits=$(grep -cE 'AD BREAK START|AD MARKER|DISCONTINUITY|CUE-OUT|SCTE35' "$f" 2>/dev/null || echo 0)
  printf '%-22s %-10s %-34s %s\n' "$name" "$up" "${prog:-starting}" "$hits"
done

echo
if grep -qhE 'AD BREAK START|AD MARKER|DISCONTINUITY|CUE-OUT|SCTE35' "$DIR"/*.log 2>/dev/null; then
  echo '>>> BOUNDARY FOUND:'
  grep -hE 'AD BREAK START|AD MARKER|DISCONTINUITY|CUE-OUT|SCTE35' "$DIR"/*.log | tail -20
else
  echo 'no ad boundary seen yet on any channel'
fi
