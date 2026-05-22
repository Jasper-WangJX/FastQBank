// electron-builder afterSign hook: notarize the signed macOS .app with
// Apple's service. This is a NO-OP unless all three Apple credentials are
// present in the environment, so builds on Windows (or any machine without
// an Apple Developer account) still succeed. To enable on a Mac, export:
//   APPLE_ID                     Apple ID email
//   APPLE_APP_SPECIFIC_PASSWORD  app-specific password from appleid.apple.com
//   APPLE_TEAM_ID                Developer Team ID
// Never commit these — keep them in the shell profile / CI secrets only.

const { notarize } = require("@electron/notarize");

exports.default = async function notarizeMac(context) {
  if (context.electronPlatformName !== "darwin") return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log(
      "[notarize] skipped — set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and " +
        "APPLE_TEAM_ID to enable notarization.",
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${context.appOutDir}/${appName}.app`;
  console.log(`[notarize] submitting ${appPath} to Apple…`);
  await notarize({
    // Must match build.appId in package.json.
    appBundleId: "com.fastqbank.desktop",
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
  console.log("[notarize] done.");
};
