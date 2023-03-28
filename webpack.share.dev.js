const webpack = require('webpack');
const merge = require('webpack-merge');
const common = require('./webpack.share.js');
const path = require('path');
const CopyPlugin = require("copy-webpack-plugin");
const VERSION = require("./version.js");

var merged = merge.merge(common, {
    mode: "development",
    output: {
        path: path.resolve(__dirname, "webshare/dist-dev"),
        filename: "[name].js",
    },
    devtool: "source-map",
    devServer: {
        static: {
            directory: path.join(__dirname, "./webshare"),
        },
        port: 9001,
        headers: {
            'Cache-Control': 'no-store',
        },
    },
    watchOptions: {
        aggregateTimeout: 200,
    },
});

var definePlugin = new webpack.DefinePlugin({
    __PROMPT_DEV__: "true",
    __PROMPT_VERSION__: JSON.stringify(VERSION),
    __PROMPT_BUILD__: JSON.stringify("devbuild"),
});
merged.plugins.push(definePlugin);

module.exports = merged;

