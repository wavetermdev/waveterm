const { signAsync } = require("@electron/osx-sign");
const path = require("path");

console.log("running osx-sign");
const waveAppPath = path.resolve(__dirname, "temp", "Wave.app");
signAsync({
    app: waveAppPath,
    binaries: [
        waveAppPath + "/Contents/Resources/app/bin/wavesrv",
        waveAppPath + "/Contents/Resources/app/bin/mshell/mshell-v0.4-linux.amd64",
        waveAppPath + "/Contents/Resources/app/bin/mshell/mshell-v0.4-linux.arm64",
        waveAppPath + "/Contents/Resources/app/bin/mshell/mshell-v0.4-darwin.amd64",
        waveAppPath + "/Contents/Resources/app/bin/mshell/mshell-v0.4-darwin.arm64",
    ],
})
    .then(() => {
        console.log("signing success");
    })
    .catch((e) => {
        console.log("signing error", e);
        process.exit(1);
    });
