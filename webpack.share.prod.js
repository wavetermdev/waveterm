const webpack = require("webpack");
const merge = require("webpack-merge");
const common = require("./webpack.share.js");
const moment = require("dayjs");
const path = require("path");
const VERSION = require("./version.js");

function makeBuildStr() {
    let buildStr = moment().format("YYYYMMDD-HHmmss");
    console.log("Prompt " + VERSION + " build " + buildStr);
    return buildStr;
}

const BUILD = makeBuildStr();

let merged = merge.merge(common, {
    mode: "production",
    output: {
        path: path.resolve(__dirname, "webshare/dist"),
        filename: "[name].js",
    },
    devtool: false,
    optimization: {
        minimize: true,
    },
});

merged.plugins.push(
    new webpack.DefinePlugin({
        __PROMPT_DEV__: "false",
        __PROMPT_VERSION__: JSON.stringify(VERSION),
        __PROMPT_BUILD__: JSON.stringify(BUILD),
        __PROMPT_API_ENDPOINT__: JSON.stringify("https://share.getprompt.dev/api"),
        __PROMPT_WSAPI_ENDPOINT__: JSON.stringify("wss://wsapi.getprompt.dev"),
    })
);

module.exports = merged;
