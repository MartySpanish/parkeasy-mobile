// Patch the generated Capacitor Android project so it is a Play Store release
// build, not the template's debug shell. Idempotent: every edit checks for its
// own marker first, so `npm run android:prepare` can be run after any
// `npx cap add android` / `npx cap update` without doubling anything up.
//
// WHAT IT DOES, AND WHY EACH THING IS HERE
//   1. AndroidManifest.xml — location + camera permissions (the WebView only
//      asks the person for these if the manifest declares them; without the
//      declaration "Use my location" silently returns nothing), and an
//      android:autoVerify intent-filter so https://parkeasy.uk links open in
//      the app once /.well-known/assetlinks.json carries the signing key.
//   2. app/build.gradle — versionCode/versionName from the environment (CI
//      passes the run number, so every upload is a higher versionCode, which
//      Play insists on), and a release signingConfig read from environment
//      variables. Nothing secret is written to disk in the repo.
//   3. styles.xml — the Android 12+ splash: navy background, app icon, no
//      white flash before the site loads.
//
// Run from the repo root: `node scripts/android-prepare.mjs`.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'android');
if (!existsSync(root)) {
  console.error('android/ not found — run `npx cap add android` first.');
  process.exit(1);
}

const edit = (rel, fn) => {
  const p = resolve(root, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after !== before) { writeFileSync(p, after); console.log('patched', rel); }
  else console.log('ok     ', rel);
};

// ---------------------------------------------------------------- manifest
edit('app/src/main/AndroidManifest.xml', (s) => {
  if (!s.includes('ACCESS_FINE_LOCATION')) {
    s = s.replace(
      '<uses-permission android:name="android.permission.INTERNET" />',
      `<uses-permission android:name="android.permission.INTERNET" />
    <!-- "Use my location" on the map. Coarse first so a person can say
         "approximate" on Android 12+ and still get nearby spots. -->
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <!-- Photo of a spot from the "Add a spot" form (input capture=environment). -->
    <uses-permission android:name="android.permission.CAMERA" />`
    );
  }
  if (!s.includes('android:autoVerify')) {
    s = s.replace(
      `                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
`,
      `                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <!-- App Links: a parkeasy.uk URL in WhatsApp, email or search opens
                 here instead of the browser. Verified against
                 https://parkeasy.uk/.well-known/assetlinks.json at install. -->
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="parkeasy.uk" />
                <data android:scheme="https" android:host="www.parkeasy.uk" />
            </intent-filter>
`
    );
  }
  return s;
});

// ------------------------------------------------------------- build.gradle
edit('app/build.gradle', (s) => {
  if (!s.includes('ANDROID_VERSION_CODE')) {
    s = s.replace(
      `        versionCode 1
        versionName "1.0"`,
      `        // CI passes the GitHub run number, so each upload to Play is a
        // strictly higher versionCode (Play rejects a repeat). Locally it
        // falls back to 1. versionName is what people see on the store.
        versionCode (System.getenv("ANDROID_VERSION_CODE") ?: "1").toInteger()
        versionName (System.getenv("ANDROID_VERSION_NAME") ?: "1.0.0")`
    );
  }
  if (!s.includes('signingConfigs')) {
    s = s.replace(
      `    buildTypes {
        release {
            minifyEnabled false`,
      `    // Release signing from the environment only. The keystore file is
    // decoded from a GitHub secret at build time and never committed.
    // If the variables are absent (a local debug build) the release build is
    // simply unsigned and Gradle says so — nothing here can leak.
    signingConfigs {
        release {
            def ksPath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (ksPath != null && file(ksPath).exists()) {
                storeFile file(ksPath)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        release {
            // Only attach the config when a keystore is actually present;
            // otherwise Gradle produces an UNSIGNED bundle/apk instead of
            // failing, which is what the no-secrets CI mode relies on.
            if (System.getenv("ANDROID_KEYSTORE_PATH") != null) {
                signingConfig signingConfigs.release
            }
            minifyEnabled false`
    );
  }
  return s;
});

// ---------------------------------------------------------------- styles
edit('app/src/main/res/values/styles.xml', (s) => {
  if (!s.includes('windowSplashScreenBackground')) {
    s = s.replace(
      `    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
    </style>`,
      `    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
        <!-- Android 12+ system splash: brand navy behind the launcher icon,
             then straight into the app. No white flash. -->
        <item name="windowSplashScreenBackground">@color/splashBackground</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>`
    );
  }
  return s;
});

// The template ships no colors.xml of its own (colorPrimary etc. come from
// the capacitor-android library), so create the file when it is missing.
{
  const p = resolve(root, 'app/src/main/res/values/colors.xml');
  if (!existsSync(p)) {
    writeFileSync(p, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="splashBackground">#0A0F1A</color>
</resources>
`);
    console.log('created', 'app/src/main/res/values/colors.xml');
  } else {
    edit('app/src/main/res/values/colors.xml', (s) => s.includes('splashBackground') ? s
      : s.replace('</resources>', `    <color name="splashBackground">#0A0F1A</color>\n</resources>`));
  }
}

// The generated adaptive-icon background colour is white by default; the
// brand background is teal (the layers in mipmap-* were built for teal).
edit('app/src/main/res/values/ic_launcher_background.xml', (s) =>
  s.replace('#FFFFFF', '#45E0C6'));

console.log('android project prepared');
