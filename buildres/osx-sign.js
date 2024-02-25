const { signAsync } = require("@electron/osx-sign");
// DEBUG="electron-osx-sign*"

console.log("running osx-sign");
let waveAppPath = "temp/Wave.app";
signAsync({
    app: "temp/Wave.app",
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
