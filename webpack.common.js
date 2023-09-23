const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const LodashModuleReplacementPlugin = require("lodash-webpack-plugin");
const path = require("path");

module.exports = {
    mode: "development",
    entry: {
        prompt: ["./src/index.ts", "./src/index.less"],
    },
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "[name].js",
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
        ],
    },
    plugins: [
        new MiniCssExtractPlugin({ filename: "[name].css", ignoreOrder: true }),
        new LodashModuleReplacementPlugin(),
    ],
    resolve: {
        extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".wasm", ".json", ".less", ".css"],
    },
};
