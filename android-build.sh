#!/bin/bash
# android-build.sh
# Builds QuietKeep Android APK + AAB for Play Store
# Usage:
#   ./android-build.sh personal    → com.pranix.quietkeep
#   ./android-build.sh business   → com.pranix.quietkeep.business
#
# Prerequisites:
#   - Node.js 18+
#   - Java 17+ (java -version)
#   - Android Studio with SDK (ANDROID_HOME set)
#   - keytool (bundled with Java)

set -e

APP_TYPE="${1:-personal}"
echo ""
echo "========================================"
echo " QuietKeep Android Build — $APP_TYPE"
echo "========================================"
echo ""

# ── CONFIG ────────────────────────────────────────────────────────
if [ "$APP_TYPE" = "business" ]; then
  APP_ID="com.pranix.quietkeep.business"
  APP_NAME="QuietKeep Business"
  KEYSTORE_FILE="quietkeep-business.keystore"
  KEYSTORE_ALIAS="quietkeep-business"
  # Swap to business config
  cp capacitor.business.config.ts capacitor.config.ts.bak 2>/dev/null || true
  cp capacitor.business.config.ts capacitor.config.ts
else
  APP_ID="com.pranix.quietkeep"
  APP_NAME="QuietKeep"
  KEYSTORE_FILE="quietkeep.keystore"
  KEYSTORE_ALIAS="quietkeep"
fi

KEYSTORE_PASS="${KEYSTORE_PASS:-QuietKeepPranix2026}"
echo "App ID    : $APP_ID"
echo "App Name  : $APP_NAME"
echo "Keystore  : $KEYSTORE_FILE"
echo ""

# ── STEP 1: Install Capacitor ─────────────────────────────────────
echo "[ 1/9 ] Installing Capacitor packages..."
npm install \
  @capacitor/core \
  @capacitor/cli \
  @capacitor/android \
  @capacitor/camera \
  @capacitor/geolocation \
  @capacitor/push-notifications \
  @capacitor/splash-screen \
  @capacitor/status-bar \
  @capacitor/keyboard \
  --legacy-peer-deps
echo "✓ Capacitor installed"

# ── STEP 2: Init Capacitor (only if android/ doesn't exist) ──────
if [ ! -d "android" ]; then
  echo "[ 2/9 ] Initialising Capacitor project..."
  npx cap init "$APP_NAME" "$APP_ID" --web-dir=out
  npx cap add android
  echo "✓ Capacitor initialised"
else
  echo "[ 2/9 ] android/ directory exists — skipping init"
fi

# ── STEP 3: Sync web assets to Android ───────────────────────────
echo "[ 3/9 ] Syncing web assets to Android..."
npx cap sync android
echo "✓ Sync complete"

# ── STEP 4: Patch AndroidManifest.xml ────────────────────────────
echo "[ 4/9 ] Patching AndroidManifest.xml..."
MANIFEST="android/app/src/main/AndroidManifest.xml"

if [ -f "$MANIFEST" ]; then
python3 - "$MANIFEST" "$APP_ID" << 'PYEOF'
import sys, re

manifest_path = sys.argv[1]
app_id = sys.argv[2]

with open(manifest_path) as f:
    content = f.read()

permissions = [
    'android.permission.INTERNET',
    'android.permission.RECORD_AUDIO',
    'android.permission.CAMERA',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.VIBRATE',
]

for perm in permissions:
    tag = f'<uses-permission android:name="{perm}"/>'
    if perm not in content:
        content = content.replace('<application', tag + '\n    <application', 1)

# Add hardware acceleration + block cleartext
if 'hardwareAccelerated' not in content:
    content = content.replace(
        'android:label=',
        'android:hardwareAccelerated="true" android:label='
    )
if 'usesCleartextTraffic' not in content:
    content = content.replace(
        'android:hardwareAccelerated=',
        'android:usesCleartextTraffic="false" android:hardwareAccelerated='
    )

with open(manifest_path, 'w') as f:
    f.write(content)
print('  ✓ Manifest patched')
PYEOF
else
  echo "  ! Manifest not found — will be created after first sync"
fi
echo "✓ Manifest patched"

# ── STEP 5: Patch build.gradle ────────────────────────────────────
echo "[ 5/9 ] Patching build.gradle..."
GRADLE="android/app/build.gradle"

if [ -f "$GRADLE" ]; then
python3 - "$GRADLE" "$APP_ID" "$KEYSTORE_FILE" "$KEYSTORE_ALIAS" "$KEYSTORE_PASS" << 'PYEOF'
import sys, re

gradle_path = sys.argv[1]
app_id = sys.argv[2]
keystore_file = sys.argv[3]
keystore_alias = sys.argv[4]
keystore_pass = sys.argv[5]

with open(gradle_path) as f:
    content = f.read()

# Update applicationId
content = re.sub(r'applicationId\s+"[^"]*"', f'applicationId "{app_id}"', content)

# Add signingConfigs if not present
if 'signingConfigs' not in content:
    signing = f'''
    signingConfigs {{
        release {{
            storeFile file("../../{keystore_file}")
            storePassword "{keystore_pass}"
            keyAlias "{keystore_alias}"
            keyPassword "{keystore_pass}"
        }}
    }}'''
    content = content.replace('buildTypes {', signing + '\n    buildTypes {', 1)
    content = re.sub(
        r'(release \{)',
        r'\1\n            signingConfig signingConfigs.release',
        content,
        count=1
    )

with open(gradle_path, 'w') as f:
    f.write(content)
print('  ✓ build.gradle patched')
PYEOF
else
  echo "  ! build.gradle not found — run after sync"
fi
echo "✓ Gradle patched"

# ── STEP 6: Generate keystore ─────────────────────────────────────
echo "[ 6/9 ] Keystore check..."
if [ ! -f "$KEYSTORE_FILE" ]; then
  echo "  Generating release keystore: $KEYSTORE_FILE"
  echo "  ⚠️  SAVE THIS FILE AND PASSWORD PERMANENTLY — YOU CANNOT REGENERATE IT"
  keytool -genkey -v \
    -keystore "$KEYSTORE_FILE" \
    -alias "$KEYSTORE_ALIAS" \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -storepass "$KEYSTORE_PASS" \
    -keypass "$KEYSTORE_PASS" \
    -dname "CN=Pranix AI Labs, OU=Engineering, O=Pranix AI Labs Pvt Ltd, L=Hyderabad, S=Telangana, C=IN"
  echo "  ✓ Keystore created: $KEYSTORE_FILE"
else
  echo "  ✓ Keystore exists: $KEYSTORE_FILE"
fi

# ── STEP 7: Build ─────────────────────────────────────────────────
echo "[ 7/9 ] Building release APK and AAB..."
cd android

echo "  Cleaning previous build..."
./gradlew clean --quiet

echo "  Building AAB (for Play Store)..."
./gradlew bundleRelease --quiet

echo "  Building APK (for direct install)..."
./gradlew assembleRelease --quiet

cd ..
echo "✓ Build complete"

# ── STEP 8: Restore config (business only) ───────────────────────
if [ "$APP_TYPE" = "business" ] && [ -f "capacitor.config.ts.bak" ]; then
  mv capacitor.config.ts.bak capacitor.config.ts
  echo "✓ Restored personal capacitor.config.ts"
fi

# ── STEP 9: Output ────────────────────────────────────────────────
echo ""
echo "========================================"
echo " BUILD COMPLETE"
echo "========================================"
echo ""
echo "Output files:"
find android/app/build/outputs -name "*.apk" -o -name "*.aab" 2>/dev/null | while read f; do
  SIZE=$(du -sh "$f" 2>/dev/null | cut -f1)
  echo "  📦 $f  ($SIZE)"
done

echo ""
echo "Next steps:"
echo "  Test APK  : adb install android/app/build/outputs/apk/release/app-release.apk"
echo "  Play Store: upload AAB at play.google.com/console"
echo "  Track     : Internal Testing → Closed Testing → Production"
echo ""
