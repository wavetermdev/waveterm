const webpack = require("webpack");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const webpackMerge = require("webpack-merge");
const path = require("path");
const moment = require("dayjs");
const VERSION = require("../version.js");
const TsconfigPathsPlugin = require("tsconfig-paths-webpack-plugin");

function makeBuildStr() {
    let buildStr = moment().format("YYYYMMDD-HHmmss");
    // console.log("waveterm:web      " + VERSION + " build " + buildStr);
    return buildStr;
}

const BUILD = makeBuildStr();

let BundleAnalyzerPlugin = null;
if (process.env.WEBPACK_ANALYZE) {
    BundleAnalyzerPlugin = require("webpack-bundle-analyzer").BundleAnalyzerPlugin;
}

var webCommon = {
    entry: {
        wave: ["./frontend/wave.ts"],
    },
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
            {
                test: /\.css$/,
                use: ["style-loader", "css-loader"],
            },
            {
                test: /\.less$/,
                use: [{ loader: MiniCssExtractPlugin.loader }, "css-loader", "less-loader"],
            },
            {
                test: /\.svg$/,
                use: [{ loader: "@svgr/webpack", options: { icon: true, svgo: false } }, "file-loader"],
            },
            {
                test: /\.md$/,
                type: "asset/source",
            },
            {
                test: /\.(png|jpe?g|gif)$/i,
                type: "asset/resource",
            },
        ],
    },
    resolve: {
        extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".wasm", ".json", ".less", ".css"],
        plugins: [
            new TsconfigPathsPlugin({
                configFile: path.resolve(__dirname, "../tsconfig.json"),
            }),
        ],
    },
};

var webDev = webpackMerge.merge(webCommon, {
    mode: "development",
    output: {
        path: path.resolve(__dirname, "../dist-dev"),
        filename: "[name].js",
    },
    devtool: "source-map",
    devServer: {
        static: {
            directory: path.join(__dirname, "../public"),
        },
        port: 9000,
        headers: {
            "Cache-Control": "no-store",
        },
    },
    plugins: [
        new MiniCssExtractPlugin({ filename: "[name].css", ignoreOrder: true }),
        new CopyPlugin({
            patterns: [
                {
                    from: "min/vs",
                    to: "monaco",
                    context: "node_modules/monaco-editor/",
                },
            ],
        }),
  		new webpack.ProvidePlugin({
     		React: 'react'
   		}),
        new webpack.DefinePlugin({
            __WAVETERM_DEV__: "true",
            __WAVETERM_VERSION__: JSON.stringify(VERSION),
            __WAVETERM_BUILD__: JSON.stringify("devbuild"),
        }),
    ],
    watchOptions: {
        aggregateTimeout: 200,
    },
});

var webProd = webpackMerge.merge(webCommon, {
    mode: "production",
    output: {
        path: path.resolve(__dirname, "../dist"),
        filename: "[name].js",
    },
    devtool: "source-map",
    plugins: [
        new MiniCssExtractPlugin({ filename: "[name].css", ignoreOrder: true }),
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
if (BundleAnalyzerPlugin != null) {
    webProd.plugins.push(new BundleAnalyzerPlugin());
}

module.exports = { webDev: webDev, webProd: webProd };
