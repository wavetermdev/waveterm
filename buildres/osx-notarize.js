// Notarize the Wave.app for macOS

const { notarize } = require("@electron/notarize");
const path = require("path");

/**
 * Notarize the Wave.app for macOS
 * @param {string} waveAppPath - Path to the Wave.app
 * @returns {Promise<void>}
 */
async function notarizeApp(waveAppPath) {
    return notarize({
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
}

if (require.main === module) {
    console.log("running osx-notarize");
    const waveAppPath = path.resolve(__dirname, "temp", "Wave.app");
    (async () => {
        await notarizeApp(waveAppPath);
        console.log("notarization complete");
    })();
}

module.exports = {
    notarizeApp,
};
