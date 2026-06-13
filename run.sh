#!/usr/bin/env bash
#
# run.sh — build the macOS app and (re)install it into /Applications.
#
# Safe to run while the app is open: it quits the running instance first,
# then replaces the bundle in /Applications and relaunches it.
#
set -euo pipefail

# Always work from the directory this script lives in.
cd "$(dirname "$0")"

APP_NAME="Mac File Manager"          # must match build.productName in package.json
APP_BUNDLE="${APP_NAME}.app"
DEST="/Applications/${APP_BUNDLE}"

echo "==> Building React app and packaging Electron app..."
npm run dist

# electron-builder writes to release/mac-<arch>/ (e.g. mac-arm64 on Apple Silicon,
# mac on Intel). Locate the freshly built bundle.
echo "==> Locating built app bundle..."
BUILT_APP="$(find release -maxdepth 2 -name "${APP_BUNDLE}" -type d | head -n 1 || true)"
if [[ -z "${BUILT_APP}" ]]; then
  echo "ERROR: Could not find '${APP_BUNDLE}' under ./release after build." >&2
  exit 1
fi
echo "    Found: ${BUILT_APP}"

# Quit the running app gracefully, then force-kill if it refuses to die.
echo "==> Quitting running instance (if any)..."
osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
for _ in $(seq 1 10); do
  pgrep -f "/Applications/${APP_BUNDLE}/Contents/MacOS/" >/dev/null 2>&1 || break
  sleep 0.5
done
# Fallback: hard kill anything still holding the bundle open.
pkill -f "${APP_BUNDLE}/Contents/MacOS/" >/dev/null 2>&1 || true
sleep 0.5

echo "==> Installing to ${DEST} ..."
# Remove the old copy, then ditto in the new one.
if rm -rf "${DEST}" 2>/dev/null && ditto "${BUILT_APP}" "${DEST}" 2>/dev/null; then
  echo "    Installed."
else
  echo "    Permission denied — retrying with sudo..."
  sudo rm -rf "${DEST}"
  sudo ditto "${BUILT_APP}" "${DEST}"
  echo "    Installed (sudo)."
fi

# Clear the quarantine flag so Gatekeeper doesn't block the relaunch.
xattr -dr com.apple.quarantine "${DEST}" 2>/dev/null || true

echo "==> Relaunching ${APP_NAME}..."
open "${DEST}"

echo "==> Done."
