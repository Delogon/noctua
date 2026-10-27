#!/usr/bin/env bash
# Dev-only (Linux): runs a command in a throwaway D-Bus session with an
# unlocked gnome-keyring so Electron safeStorage finds a backend.
# Usage: dbus-run-session -- scripts/with-keyring.sh <command …>
eval "$(echo -n 'noctua' | gnome-keyring-daemon --unlock --components=secrets 2>/dev/null)"
export GNOME_KEYRING_CONTROL
exec "$@"
