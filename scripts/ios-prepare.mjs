// Patch the generated Capacitor iOS project so it is App Store-ready.
// Idempotent — every edit checks for its own marker, so it is safe to run after
// `npx cap add ios` / `npx cap sync ios` any number of times.
//
//   1. Info.plist — the usage-description strings App Review requires for any
//      permission the WebView can ask for (location, camera, photo library);
//      ITSAppUsesNonExemptEncryption=false so every TestFlight build does not
//      stop at the export-compliance question; portrait-only on iPhone (the
//      map UI is designed for it); iPad orientations left as generated.
//   2. App.entitlements — Associated Domains so https://parkeasy.uk links open
//      in the app (needs /.well-known/apple-app-site-association on the site,
//      which carries the Team ID: see docs/IOS_RELEASE.md).
//   3. PrivacyInfo.xcprivacy — the privacy manifest Apple requires since
//      spring 2024: data types collected and the "required reason" APIs used
//      (UserDefaults, via Capacitor's Preferences).
//   4. project.pbxproj — wire the entitlements file and set the display name;
//      MARKETING_VERSION / CURRENT_PROJECT_VERSION come from the environment at
//      build time (CI passes the run number), defaulting to 1.0.0 / 1.
//
// Run from the repo root: `node scripts/ios-prepare.mjs`.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd(), 'ios/App');
if (!existsSync(root)) {
  console.error('ios/App not found — run `npx cap add ios` first.');
  process.exit(1);
}
const edit = (rel, fn) => {
  const p = resolve(root, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after !== before) { writeFileSync(p, after); console.log('patched', rel); }
  else console.log('ok     ', rel);
};
const write = (rel, content) => {
  const p = resolve(root, rel);
  if (existsSync(p) && readFileSync(p, 'utf8') === content) { console.log('ok     ', rel); return; }
  writeFileSync(p, content); console.log('wrote  ', rel);
};

// ---------------------------------------------------------------- Info.plist
edit('App/Info.plist', (s) => {
  if (!s.includes('NSLocationWhenInUseUsageDescription')) {
    s = s.replace(
      `	<key>LSRequiresIPhoneOS</key>
	<true/>`,
      `	<key>LSRequiresIPhoneOS</key>
	<true/>
	<!-- Permission strings. Each is shown by iOS in the prompt and read by App
	     Review; a missing one is an automatic rejection. Only asked when the
	     person taps the matching button in the app. -->
	<key>NSLocationWhenInUseUsageDescription</key>
	<string>ParkEasy uses your location to show parking spots near you and sort results by walking distance. It is only used while the app is open.</string>
	<key>NSCameraUsageDescription</key>
	<string>Take a photo of a parking spot to add it to the map for other drivers.</string>
	<key>NSPhotoLibraryUsageDescription</key>
	<string>Choose a photo of a parking spot to add it to the map for other drivers.</string>
	<!-- No proprietary encryption; only HTTPS. Skips the export-compliance
	     question on every TestFlight upload. -->
	<key>ITSAppUsesNonExemptEncryption</key>
	<false/>`
    );
  }
  // Portrait only on iPhone — the map UI is designed for it. iPad keeps all.
  s = s.replace(
    `	<key>UISupportedInterfaceOrientations</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
	</array>`,
    `	<key>UISupportedInterfaceOrientations</key>
	<array>
		<string>UIInterfaceOrientationPortrait</string>
	</array>`
  );
  return s;
});

// ------------------------------------------------------------ entitlements
write('App/App.entitlements', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<!-- Universal Links: a parkeasy.uk URL opens in the app. Verified by iOS
	     against https://parkeasy.uk/.well-known/apple-app-site-association,
	     which must list this app's TEAMID.com.parkeasy.belfast. -->
	<key>com.apple.developer.associated-domains</key>
	<array>
		<string>applinks:parkeasy.uk</string>
		<string>applinks:www.parkeasy.uk</string>
	</array>
</dict>
</plist>
`);

// ------------------------------------------------------- privacy manifest
write('App/PrivacyInfo.xcprivacy', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSPrivacyTracking</key>
	<false/>
	<key>NSPrivacyTrackingDomains</key>
	<array/>
	<!-- What the app collects, matching the App Store Connect "App Privacy"
	     answers and https://parkeasy.uk/privacy. Location is used on-device
	     only and not stored against the account, so it is not listed as
	     collected; email/name/vehicle reg are, for the booking service. -->
	<key>NSPrivacyCollectedDataTypes</key>
	<array>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeEmailAddress</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<true/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeName</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<true/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeOtherUserContentTypes</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<true/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypePurchaseHistory</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<true/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypePhotosorVideos</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<false/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string>
			</array>
		</dict>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeProductInteraction</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<false/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>NSPrivacyCollectedDataTypePurposeAnalytics</string>
			</array>
		</dict>
	</array>
	<!-- "Required reason" APIs. Capacitor reads UserDefaults for its own
	     preferences (reason CA92.1: app's own data only). -->
	<key>NSPrivacyAccessedAPITypes</key>
	<array>
		<dict>
			<key>NSPrivacyAccessedAPIType</key>
			<string>NSPrivacyAccessedAPICategoryUserDefaults</string>
			<key>NSPrivacyAccessedAPITypeReasons</key>
			<array>
				<string>CA92.1</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`);

// ---------------------------------------------------------- project.pbxproj
edit('App.xcodeproj/project.pbxproj', (s) => {
  if (!s.includes('CODE_SIGN_ENTITLEMENTS')) {
    // Add to both App target configurations (Debug + Release). They are the
    // blocks that carry PRODUCT_BUNDLE_IDENTIFIER.
    s = s.replace(/(\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com\.parkeasy\.belfast;\n)/g,
      `$1\t\t\t\tCODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n\t\t\t\tINFOPLIST_KEY_CFBundleDisplayName = ParkEasy;\n`);
  }
  // Versions from the environment at build time. Xcode reads these as build
  // settings; CI overrides them on the xcodebuild command line, so the values
  // here are only the local defaults.
  s = s.replace(/MARKETING_VERSION = 1\.0;/g, 'MARKETING_VERSION = 1.0.0;');
  // Register the new files with the project so they are copied into the app.
  // (PrivacyInfo.xcprivacy must be in the bundle; the entitlements file only
  // needs to exist at the path above.)
  if (!s.includes('PrivacyInfo.xcprivacy')) {
    const fileRefId = 'PE0000000000000000000001';
    const buildFileId = 'PE0000000000000000000002';
    s = s.replace('/* End PBXFileReference section */',
      `\t\t${fileRefId} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };\n/* End PBXFileReference section */`);
    s = s.replace('/* End PBXBuildFile section */',
      `\t\t${buildFileId} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${fileRefId} /* PrivacyInfo.xcprivacy */; };\n/* End PBXBuildFile section */`);
    // into the App group (the one that lists Info.plist)
    s = s.replace(/(\/\* Info\.plist \*\/,\n)/, `$1\t\t\t\t${fileRefId} /* PrivacyInfo.xcprivacy */,\n`);
    // into the Resources build phase (the one that lists LaunchScreen.storyboard)
    s = s.replace(/(\/\* LaunchScreen\.storyboard in Resources \*\/,\n)/, `$1\t\t\t\t${buildFileId} /* PrivacyInfo.xcprivacy in Resources */,\n`);
  }
  return s;
});

console.log('ios project prepared');
