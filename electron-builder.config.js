const pkg = require("./package.json");

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const config = {
    artifactName: "${productName}-${version}-${arch}.${ext}",
    npmRebuild: false,
    nodeGypRebuild: false,
    electronCompile: false,
    publish: {
        provider: "s3",
        bucket: "waveterm-test-autoupdate",
        endpoint: "https://waveterm-test-autoupdate.s3.us-west-2.amazonaws.com/autoupdate",
    },
    files: [
        {
            from: "./dist",
            to: "./dist",
            filter: ["**/*"],
        },
        {
            from: "./public",
            to: "./public",
            filter: ["**/*"],
        },
        {
            from: "./bin",
            to: "./bin",
            filter: ["**/*"],
        },
        {
            from: ".",
            to: ".",
            filter: ["package.json"],
        },
        "!**/node_modules/**${/*}", // Ignore node_modules by default
        {
            from: "./node_modules",
            to: "./node_modules",
            filter: ["monaco-editor/min/**/*"], // This is the only module we want to include
        },
    ],
    directories: {
        output: "make",
    },
    appId: pkg.build.appId,
    productName: pkg.productName,
    mac: {
        target: {
            target: "zip",
            arch: "universal",
        },
        icon: "public/waveterm.icns",
        category: "public.app-category.developer-tools",
        minimumSystemVersion: "10.15.0",
        asarUnpack: ["bin/**/*"],
    },
    linux: {
        executableName: pkg.productName,
        category: "TerminalEmulator",
        icon: "public/waveterm.icns",
        target: ["zip", "deb", "rpm", "AppImage"],
        asar: false,
        desktop: {
            Name: pkg.productName,
            Comment: pkg.description,
            Keywords: "developer;terminal;emulator;",
            category: "Development;Utility;",
        },
    },
};

module.exports = config;
