const { notarize } = require('@electron/notarize');
// DEBUG=electron-notarize

notarize({
    appPath: "temp/Wave.app",
    tool: "notarytool",
    keychainProfile: "notarytool-creds",
}).then(() => {
    console.log("notarize success");
}).catch((e) => {
    console.log("notarize error", e);
    process.exit(1);
});
