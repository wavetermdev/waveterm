const eu = require("@electron/universal");
const path = require("path");

let x64Path = path.resolve(__dirname, "temp", "x64", "Wave.app");
let arm64Path = path.resolve(__dirname, "temp", "arm64", "Wave.app");
let outPath = path.resolve(__dirname, "temp", "Wave.app");

console.log("building universal package");
console.log("x64 path", x64Path);
console.log("arm64 path", arm64Path);
console.log("output path", outPath);

(async () => {
    await eu.makeUniversalApp({
        x64AppPath: x64Path,
        arm64AppPath: arm64Path,
        outAppPath: outPath,
    });
    console.log("created macos universal app");
})();
