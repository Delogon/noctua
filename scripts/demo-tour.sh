#!/usr/bin/env bash
# Dev-only: Demo-Daten + Screenshot-Tour unter Xvfb (Linux, headless).
#
#   scripts/demo-tour.sh [ausgabeordner]
#
# Umgebung (optional): DEMO_LOCAL_ONLY=1  Local only einschalten
#                      DEMO_LANG=de|en    UI-Sprache (Standard en)
#                      DEMO_PASS=main|local|small|onboarding|decision   Tour-Durchlauf (Standard main)
#                        decision zeigt Entscheidungsmodelle (Fake-Ollama mit clef-flash): Karte in
#                        Einstellungen → KI, Regel mit KI-Bedingung, Phishing-Warnung. Mit
#                        DEMO_NO_DECISION=1 zeigt onboarding stattdessen den Tipp ohne Modell.
#                        onboarding zeigt die KI-Wahl (Fake-Ollama auf 127.0.0.1:11434); mit einem
#                        Build mit Org-Konfiguration stattdessen die Org-Profile:
#                        NOCTUA_ORG_CONFIG=build/org-config.example.json pnpm exec electron-vite build
#                      DEMO_TIMEOUT=240   Abbruch in Sekunden
#
# Voraussetzungen: gebauter Main/Renderer (`pnpm exec electron-vite build`),
# xvfb, dbus-run-session und gnome-keyring (safeStorage braucht unter Linux ein
# Secret-Backend; der Schlüsselcode schlägt ohne bewusst fehl und bleibt
# unverändert — das Keyring läuft nur in dieser Wegwerf-Session).
# Nichts davon wirkt auf einem Produktions-Build: NOCTUA_DEV/NOCTUA_DEMO_SEED
# greifen nur außerhalb eines app.asar (siehe src/main/security.ts).
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
