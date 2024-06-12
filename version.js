const path = require("path");
const packageJson = require(path.resolve(__dirname, "package.json"));

const VERSION = `${packageJson.version}`;
module.exports = VERSION;
