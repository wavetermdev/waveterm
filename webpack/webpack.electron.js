const webpack = require("webpack");
const webpackMerge = require("webpack-merge");
const path = require("path");
const moment = require("dayjs");
const VERSION = require("../version.js");
const CopyPlugin = require("copy-webpack-plugin");

function makeBuildStr() {
    let buildStr = moment().format("YYYYMMDD-HHmmss");
    // console.log("waveterm:electron " + VERSION + " build " + buildStr);
    return buildStr;
}

const BUILD = makeBuildStr();

var electronCommon = {
    entry: {
        emain: ["./emain/emain.ts"],
    },
    target: "electron-main",
    externals: {
        fs: "require('fs')",
        "fs-ext": "require('fs-ext')",
    },
    devtool: "source-map",
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                // exclude: /node_modules/,
                use: {
                    loader: "babel-loader",
                    options: {
                        presets: [
                            [
                                "@babel/preset-env",
                                {
                                    targets:
                                        "defaults and not ie > 0 and not op_mini all and not op_mob > 0 and not kaios > 0 and not and_qq > 0 and not and_uc > 0 and not baidu > 0",
                                },
                            ],
                            "@babel/preset-react",
                            "@babel/preset-typescript",
                        ],
                        plugins: [
                            ["@babel/transform-runtime", { regenerator: true }],
                            "@babel/plugin-transform-react-jsx",
                            ["@babel/plugin-proposal-decorators", { legacy: true }],
                            ["@babel/plugin-proposal-class-properties", { loose: true }],
                            ["@babel/plugin-proposal-private-methods", { loose: true }],
                            ["@babel/plugin-proposal-private-property-in-object", { loose: true }],
                            "babel-plugin-jsx-control-statements",
                        ],
                    },
                },
            },
        ],
    },
    resolve: {
        extensions: [".ts", ".tsx", ".js"],
        alias: {
            "@/app": path.resolve(__dirname, "../src/app/"),
            "@/util": path.resolve(__dirname, "../src/util/"),
            "@/models": path.resolve(__dirname, "../src/models/"),
            "@/common": path.resolve(__dirname, "../src/app/common/"),
            "@/elements": path.resolve(__dirname, "../src/app/common/elements/"),
            "@/modals": path.resolve(__dirname, "../src/app/common/modals/"),
            "@/assets": path.resolve(__dirname, "../src/app/assets/"),
            "@/plugins": path.resolve(__dirname, "../src/plugins/"),
            "@/autocomplete": path.resolve(__dirname, "../src/autocomplete/"),
        },
    },
};

var electronDev = webpackMerge.merge(electronCommon, {
    mode: "development",
    output: {
        path: path.resolve(__dirname, "../dist-dev"),
        filename: "[name].js",
    },
    plugins: [
        new CopyPlugin({
            patterns: [{ from: "emain/preload.js", to: "preload.js" }],
        }),
        new webpack.DefinePlugin({
            __WAVETERM_DEV__: "true",
            __WAVETERM_VERSION__: JSON.stringify(VERSION),
            __WAVETERM_BUILD__: JSON.stringify("devbuild"),
        }),
    ],
});

var electronProd = webpackMerge.merge(electronCommon, {
    mode: "production",
    output: {
        path: path.resolve(__dirname, "../dist"),
        filename: "[name].js",
    },
    plugins: [
        new CopyPlugin({
            patterns: [{ from: "src/electron/preload.js", to: "preload.js" }],
        }),
        new webpack.DefinePlugin({
            __WAVETERM_DEV__: "false",
            __WAVETERM_VERSION__: JSON.stringify(VERSION),
            __WAVETERM_BUILD__: JSON.stringify(BUILD),
        }),
    ],
    optimization: {
        minimize: true,
    },
});

module.exports = { electronDev: electronDev, electronProd: electronProd };
