const path = require("path");
const packageJson = require(path.resolve(__dirname, "package.json"));

const VERSION = `v${packageJson.version}`;
module.exports = VERSION;
