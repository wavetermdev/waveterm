const { notarize } = require("@electron/notarize");
// DEBUG=electron-notarize
const path = require("path");

console.log("running osx-notarize");
const waveAppPath = path.resolve(__dirname, "temp", "Wave.app");

notarize({
    appPath: waveAppPath,
    tool: "notarytool",
    keychainProfile: "notarytool-creds",
})
    .then(() => {
        console.log("notarize success");
    })
    .catch((e) => {
        console.log("notarize error", e);
        process.exit(1);
    });
