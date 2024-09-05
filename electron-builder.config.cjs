const { Arch } = require("electron-builder");
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
    afterPack: (context) => {
        // This is a workaround to restore file permissions to the wavesrv binaries on macOS after packaging the universal binary.
        if (context.electronPlatformName === "darwin" && context.arch === Arch.universal) {
            const packageBinDir = path.join(
                context.appOutDir,
                `${pkg.name}.app/Contents/Resources/app.asar.unpacked/dist/bin`
            );

            // Reapply file permissions to the wavesrv binaries in the final app package
            fs.readdirSync(packageBinDir, {
                recursive: true,
                withFileTypes: true,
            })
                .filter((f) => f.isFile() && f.name.startsWith("wavesrv"))
                .forEach((f) => fs.chmodSync(path.resolve(f.parentPath ?? f.path, f.name), 0o755)); // 0o755 corresponds to -rwxr-xr-x
        }
    },
};

module.exports = config;
