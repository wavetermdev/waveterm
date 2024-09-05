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
    executableName: pkg.name,
    artifactName: "${productName}-${platform}-${arch}-${version}.${ext}",
    npmRebuild: false,
    nodeGypRebuild: false,
    electronCompile: false,
    files: [
        {
            from: "./dist",
            to: "./dist",
            filter: ["**/*", "!bin/*", "bin/wavesrv.${arch}*", "bin/wsh*"],
        },
        {
            from: ".",
            to: ".",
            filter: ["package.json"],
        },
        "!node_modules", // We don't need electron-builder to package in Node modules as Vite has already bundled any code that our program is using.
    ],
    directories: {
        output: "make",
    },
    asarUnpack: [
        "dist/bin/**/*", // wavesrv and wsh binaries
    ],
    mac: {
        target: [
            {
                target: "zip",
                arch: ["universal", "arm64", "x64"],
            },
            {
                target: "dmg",
                arch: ["universal", "arm64", "x64"],
            },
        ],
        icon: "build/icons.icns",
        category: "public.app-category.developer-tools",
        minimumSystemVersion: "10.15.0",
        notarize: process.env.APPLE_TEAM_ID
            ? {
                  teamId: process.env.APPLE_TEAM_ID,
              }
            : false,
        mergeASARs: true,
        singleArchFiles: "dist/bin/wavesrv.*",
        binaries: fs
            .readdirSync("./dist/bin", { recursive: true, withFileTypes: true })
            .filter((f) => f.isFile() && (f.name.startsWith("wavesrv") || f.name.includes("darwin")))
            .map((f) => {
                const resolvedPath = path.resolve(f.parentPath ?? f.path, f.name);
                console.log("resolvedPath", resolvedPath);
                return resolvedPath;
            })
            .filter((path) => path),
    },
    linux: {
        artifactName: "${name}-${platform}-${arch}-${version}.${ext}",
        category: "TerminalEmulator",
        icon: "build/icons.icns",
        target: ["zip", "deb", "rpm", "AppImage", "pacman"],
        synopsis: pkg.description,
        description: null,
        desktop: {
            Name: pkg.productName,
            Comment: pkg.description,
            Keywords: "developer;terminal;emulator;",
            category: "Development;Utility;",
        },
    },
    win: {
        icon: "build/icons.icns",
        publisherName: "Command Line Inc",
        target: ["nsis", "msi", "zip"],
        certificateSubjectName: "Command Line Inc",
        certificateSha1: process.env.SM_CODE_SIGNING_CERT_SHA1_HASH,
        signingHashAlgorithms: ["sha256"],
    },
    appImage: {
        license: "LICENSE",
    },
    publish: {
        provider: "generic",
        url: "https://dl.waveterm.dev/releases-w2",
    },
};

module.exports = config;
