#!/bin/zsh
# Clean dev (re)start: kills ALL project instances (electron-vite, this repo's
# Electron binary, orphaned renderer ports), then starts dev.
# Prevents piling up zombie windows on frequent restarts.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

pkill -f "electron-vite.*(dev|preview)" 2>/dev/null
pkill -f "$ROOT/scripts/dev.mjs" 2>/dev/null
# pnpm puts the Electron binary under node_modules/.pnpm/… — the pattern must
# match both layouts, otherwise instances survive (three zombies on 07.07.).
pkill -f "$ROOT/node_modules/.*Electron.app/Contents/MacOS/Electron" 2>/dev/null
pkill -f "$ROOT/node_modules/.cache/noctua-dev/Noctua.app/Contents/MacOS/Noctua" 2>/dev/null
for port in 5173 5174 5175 5176 5177; do
  lsof -ti ":$port" 2>/dev/null | xargs kill 2>/dev/null
done
sleep 1
# Hard-kill stragglers
pkill -9 -f "$ROOT/node_modules/.*Electron.app/Contents/MacOS/Electron" 2>/dev/null
pkill -9 -f "$ROOT/node_modules/.cache/noctua-dev/Noctua.app/Contents/MacOS/Noctua" 2>/dev/null
sleep 0.5

exec pnpm --dir "$ROOT" dev "$@"
