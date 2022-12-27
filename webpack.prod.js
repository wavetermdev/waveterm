const webpack = require('webpack');
const merge = require('webpack-merge');
const common = require('./webpack.common.js');
const moment = require("dayjs");
const VERSION = "v0.1.0";
const path = require("path");

function makeBuildStr() {
    let buildStr = moment().format("YYYYMMDD-HHmmss");
    console.log("Prompt " + VERSION + " build " + buildStr);
    return buildStr;
}

const BUILD = makeBuildStr();

let BundleAnalyzerPlugin = null;
if (process.env.WEBPACK_ANALYZE) {
    BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
}

let merged = merge.merge(common, {
    mode: "production",
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "[name].js",
    },
    devtool: "source-map",
    optimization: {
        minimize: true,
    },
});

if (BundleAnalyzerPlugin != null) {
    merged.plugins.push(new BundleAnalyzerPlugin());
}
merged.plugins.push(new webpack.DefinePlugin({
    __SHDEV__: "false",
    __SHVERSION__: JSON.stringify(VERSION),
    __SHBUILD__: JSON.stringify(BUILD),
}));

module.exports = merged;



