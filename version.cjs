const path = require("path");
const packageJson = require(path.resolve(__dirname, "package.json"));

const VERSION = `${packageJson.version}`;
module.exports = VERSION;

if (typeof require !== "undefined" && require.main === module) {
    console.log(VERSION);
}
