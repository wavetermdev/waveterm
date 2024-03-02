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
            from: "./node_modules",
            to: "./node_modules",
            filter: ["monaco-editor/min/*"],
        },
        {
            from: ".",
            to: ".",
            filter: ["package.json"],
        },
    ],
    directories: {
        output: "buildres/builder",
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
        target: ["zip", "rpm", "deb", "flatpak", "pacman"],
        desktop: {
            Name: pkg.productName,
            Comment: pkg.description,
            Exec: pkg.productName,
            Icon: pkg.build.appId,
            Keywords: "developer;terminal;emulator;",
            category: "Development;Utility;",
        },
    },
};

module.exports = config;
