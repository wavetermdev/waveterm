const { signAsync } = require("@electron/osx-sign");
const path = require("path");
const fs = require("fs");

console.log("running osx-sign");
const waveAppPath = path.resolve(__dirname, "temp", "Wave.app");
const binDirPath = path.resolve(__dirname, "temp", "Wave.app", "Contents", "Resources", "app.asar.unpacked", "bin");
const binFilePaths = fs.readdirSync(binDirPath, { recursive: true }).map((f) => path.resolve(binDirPath, f));
signAsync({
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
