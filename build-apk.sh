#!/usr/bin/env bash
# AeroBuilder — web build + native Android APK uretimi (tek komut)
set -euo pipefail

PROJ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJ_DIR"

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"

echo "==> 1/4 Web derlemesi (vite build)"
npm run build

echo "==> 2/4 Capacitor sync (dist -> android/app/src/main/assets/public)"
npx cap sync android

echo "==> 3/4 Native APK derlemesi (release, imzali)"
cd android
./gradlew assembleRelease --no-daemon

APK="$PROJ_DIR/android/app/build/outputs/apk/release/app-release.apk"
echo "==> 4/4 Cikti: $APK"
ls -lh "$APK"

if systemctl --user is-active --quiet aeroplan-web.service; then
  systemctl --user restart aeroplan-web.service
  echo "==> Web servisi (port 1932) yeniden baslatildi"
fi
