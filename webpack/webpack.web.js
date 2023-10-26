const webpack = require("webpack");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const LodashModuleReplacementPlugin = require("lodash-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const webpackMerge = require("webpack-merge");
const path = require("path");
const moment = require("dayjs");
const VERSION = require("../version.js");

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
        waveterm: ["./src/index.ts", "./src/app/app.less"],
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
                use: ["@svgr/webpack", "file-loader"],
            },
            {
                test: /\.md$/,
                use: "raw-loader",
            },
        ],
    },
    resolve: {
        extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".wasm", ".json", ".less", ".css"],
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
        new LodashModuleReplacementPlugin(),
        new webpack.DefinePlugin({
            __PROMPT_DEV__: "true",
            __PROMPT_VERSION__: JSON.stringify(VERSION),
            __PROMPT_BUILD__: JSON.stringify("devbuild"),
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
    devtool: false,
    plugins: [
        new MiniCssExtractPlugin({ filename: "[name].css", ignoreOrder: true }),
        new LodashModuleReplacementPlugin(),
        new webpack.DefinePlugin({
            __PROMPT_DEV__: "false",
            __PROMPT_VERSION__: JSON.stringify(VERSION),
            __PROMPT_BUILD__: JSON.stringify(BUILD),
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
