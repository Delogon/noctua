#!/usr/bin/env bash
# Dev-only (Linux): führt einen Befehl in einer Wegwerf-D-Bus-Session mit
# entsperrtem gnome-keyring aus, damit Electron safeStorage ein Backend findet.
# Aufruf: dbus-run-session -- scripts/with-keyring.sh <befehl …>
eval "$(echo -n 'noctua' | gnome-keyring-daemon --unlock --components=secrets 2>/dev/null)"
export GNOME_KEYRING_CONTROL
exec "$@"
