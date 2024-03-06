const pkg = require("./package.json");
const fs = require("fs");
const path = require("path");

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const config = {
    appId: pkg.build.appId,
    productName: pkg.productName,
    artifactName: "${productName}-${platform}-${arch}-${version}.${ext}",
    npmRebuild: false,
    nodeGypRebuild: false,
    electronCompile: false,
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
    asarUnpack: ["bin/**/*"],
    mac: {
        target: [
            {
                target: "zip",
                arch: "universal",
            },
            {
                target: "dmg",
                arch: "universal",
            },
        ],
        icon: "public/waveterm.icns",
        category: "public.app-category.developer-tools",
        minimumSystemVersion: "10.15.0",
        binaries: fs
            .readdirSync("bin", { recursive: true, withFileTypes: true })
            .filter((f) => f.isFile())
            .map((f) => path.resolve(f.path, f.name)),
    },
    linux: {
        executableName: pkg.productName,
        category: "TerminalEmulator",
        icon: "public/waveterm.icns",
        target: ["zip", "deb", "rpm", "AppImage"],
        synopsis: pkg.description,
        description: null,
        desktop: {
            Name: pkg.productName,
            Comment: pkg.description,
            Keywords: "developer;terminal;emulator;",
            category: "Development;Utility;",
        },
    },
    appImage: {
        license: "LICENSE",
    },
    publish: {
        provider: "generic",
        url: "https://waveterm-test-autoupdate.s3.us-west-2.amazonaws.com/autoupdate",
    },
};

module.exports = config;
