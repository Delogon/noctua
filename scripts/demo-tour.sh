#!/usr/bin/env bash
# Dev-only: demo data + screenshot tour under Xvfb (Linux, headless).
#
#   scripts/demo-tour.sh [output-dir]
#
# Environment (opt.):  DEMO_LOCAL_ONLY=1  turn on Local only
#                      DEMO_LANG=de|en    UI language (default en)
#                      DEMO_PASS=main|local|small|onboarding|decision   tour pass (default main)
#                        decision shows decision models (fake Ollama with clef-flash): card in
#                        Settings → AI, rule with AI condition, phishing warning. With
#                        DEMO_NO_DECISION=1, onboarding shows the no-model tip instead.
#                        onboarding shows the AI choice (fake Ollama on 127.0.0.1:11434); with a
#                        build with org config, the org profiles instead:
#                        NOCTUA_ORG_CONFIG=build/org-config.example.json pnpm exec electron-vite build
#                      DEMO_TIMEOUT=240   abort after seconds
#
# Requirements: built main/renderer (`pnpm exec electron-vite build`),
# xvfb, dbus-run-session and gnome-keyring (on Linux safeStorage needs a
# secret backend; the key code deliberately fails without one and stays
# unchanged — the keyring only runs in this throwaway session).
# None of this affects a production build: NOCTUA_DEV/NOCTUA_DEMO_SEED
# only apply outside an app.asar (see src/main/security.ts).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-${TMPDIR:-/tmp}/noctua-demo-shots}"
ELECTRON="$ROOT/node_modules/electron/dist/electron"
UD="$(mktemp -d)"
mkdir -p "$OUT"

export TZ="${TZ:-Europe/Berlin}"
export NOCTUA_DEV=1 NOCTUA_DEMO_SEED=1 NOCTUA_TEST_SHOTS=demo
export NOCTUA_SHOT_DIR="$OUT" NOCTUA_DEMO_LANG="${DEMO_LANG:-en}"
export NOCTUA_DEMO_NO_DECISION="${DEMO_NO_DECISION:-0}"
export NOCTUA_DEMO_LOCAL_ONLY="${DEMO_LOCAL_ONLY:-0}" NOCTUA_DEMO_PASS="${DEMO_PASS:-main}"
if [ "${DEMO_PASS:-main}" = onboarding ]; then export NOCTUA_DEMO_ONBOARDING=1; fi

timeout "${DEMO_TIMEOUT:-240}" xvfb-run -a -s "-screen 0 1440x900x24" \
  dbus-run-session -- "$ROOT/scripts/with-keyring.sh" \
  "$ELECTRON" "$ROOT" --user-data-dir="$UD" --password-store=gnome-libsecret --no-sandbox \
  2>&1 | grep -v -E 'dbus/bus.cc|SharpElectronLinux|trace-warnings' | tee "$OUT/console.log"
rm -rf "$UD"
