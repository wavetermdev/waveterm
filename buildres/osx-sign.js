// Sign the app and binaries for macOS

const { signAsync } = require("@electron/osx-sign");
const path = require("path");
const fs = require("fs");

/**
 * Sign the app and binaries for macOS
 * @param {string} waveAppPath - Path to the Wave.app
 * @returns {Promise<void>}
 */
async function signApp(waveAppPath) {
    const binDirPath = path.resolve(waveAppPath, "Contents", "Resources", "app.asar.unpacked", "bin");
    const binFilePaths = fs
        .readdirSync(binDirPath, { recursive: true, withFileTypes: true })
        .filter((f) => f.isFile())
        .map((f) => path.resolve(binDirPath, f.path, f.name));
    console.log("waveAppPath", waveAppPath);
    console.log("binDirPath", binDirPath);
    console.log("binFilePaths", binFilePaths);
    return signAsync({
        app: waveAppPath,
        binaries: binFilePaths,
    })
        .then(() => {
            console.log("signing success");
        })
        .catch((e) => {
            console.log("signing error", e);
            process.exit(1);
        });
}

if (require.main === module) {
    console.log("running osx-sign");
    const waveAppPath = path.resolve(__dirname, "temp", "Wave.app");
    (async () => {
        await signApp(waveAppPath);
        console.log("signing complete");
    })();
}

module.exports = {
    signApp,
};
