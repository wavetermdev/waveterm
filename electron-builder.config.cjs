const { Arch } = require("electron-builder");
const pkg = require("./package.json");
const fs = require("fs");
const path = require("path");

const windowsShouldSign = !!process.env.SM_CODE_SIGNING_CERT_SHA1_HASH;
const windowsShouldEditExecutable = windowsShouldSign || process.env.WAVETERM_WINDOWS_EDIT_EXECUTABLE === "1";
const windowsShouldBuildInstallers = windowsShouldSign || process.env.WAVETERM_WINDOWS_INSTALLERS === "1";
const windowsTargets = windowsShouldBuildInstallers ? ["nsis", "msi", "zip"] : ["zip"];
const localWindowsElectronDist = path.resolve(__dirname, "node_modules", "electron", "dist");
const useLocalWindowsElectronDist =
    process.platform === "win32" && fs.existsSync(path.join(localWindowsElectronDist, "electron.exe"));
const windowsIconPath = path.resolve(__dirname, "assets", "appicon-windows.ico");
const electronBuilderManualToolsDir =
    process.env.LOCALAPPDATA != null
        ? path.resolve(process.env.LOCALAPPDATA, "electron-builder", "manual-tools")
        : null;
const localNsisBinaryDir =
    electronBuilderManualToolsDir == null
        ? null
        : path.join(electronBuilderManualToolsDir, "nsis-3.0.4.1");
const localNsisResourcesDir =
    electronBuilderManualToolsDir == null
        ? null
        : path.join(electronBuilderManualToolsDir, "nsis-resources-3.4.1");
const hasLocalNsisDirs =
    localNsisBinaryDir != null &&
    localNsisResourcesDir != null &&
    fs.existsSync(localNsisBinaryDir) &&
    fs.existsSync(localNsisResourcesDir);

if (hasLocalNsisDirs) {
    process.env.ELECTRON_BUILDER_NSIS_DIR ??= localNsisBinaryDir;
    process.env.ELECTRON_BUILDER_NSIS_RESOURCES_DIR ??= localNsisResourcesDir;
}

function getBuildVersion(version) {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([A-Za-z0-9.-]+))?$/);
    if (match == null) {
        return version;
    }
    const [, major, minor, patch, prerelease] = match;
    let sequence = "0";
    if (prerelease != null) {
        const numericIdentifiers = prerelease.split(".").filter((part) => /^\d+$/.test(part));
        if (numericIdentifiers.length > 0) {
            sequence = numericIdentifiers[numericIdentifiers.length - 1];
        }
    }
    return `${major}.${minor}.${patch}.${sequence}`;
}

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const config = {
    appId: pkg.build.appId,
    productName: pkg.productName,
    buildVersion: getBuildVersion(pkg.version),
    executableName: pkg.productName,
    artifactName: "${productName}-${platform}-${arch}-${version}.${ext}",
    generateUpdatesFilesForAllChannels: true,
    npmRebuild: false,
    nodeGypRebuild: false,
    electronCompile: false,
    electronDist: useLocalWindowsElectronDist ? localWindowsElectronDist : null,
    files: [
        {
            from: "./dist",
            to: "./dist",
            filter: ["**/*", "!bin/*", "bin/wavesrv.${arch}*", "bin/wsh*", "!tsunamiscaffold/**/*"],
        },
        {
            from: ".",
            to: ".",
            filter: ["package.json"],
        },
        "!node_modules", // We don't need electron-builder to package in Node modules as Vite has already bundled any code that our program is using.
    ],
    extraResources: [
        {
            from: "dist/tsunamiscaffold",
            to: "tsunamiscaffold",
        },
    ],
    directories: {
        output: "make",
    },
    asarUnpack: [
        "dist/bin/**/*", // wavesrv and wsh binaries
        "dist/schema/**/*", // schema files for Monaco editor
    ],
    mac: {
        target: [
            {
                target: "zip",
                arch: ["arm64", "x64"],
            },
            {
                target: "dmg",
                arch: ["arm64", "x64"],
            },
        ],
        category: "public.app-category.developer-tools",
        minimumSystemVersion: "10.15.0",
        mergeASARs: true,
        singleArchFiles: "**/dist/bin/wavesrv.*",
        entitlements: "build/entitlements.mac.plist",
        entitlementsInherit: "build/entitlements.mac.plist",
        extendInfo: {
            NSContactsUsageDescription: "A CLI application running in Wave wants to use your contacts.",
            NSRemindersUsageDescription: "A CLI application running in Wave wants to use your reminders.",
            NSLocationWhenInUseUsageDescription:
                "A CLI application running in Wave wants to use your location information while active.",
            NSLocationAlwaysUsageDescription:
                "A CLI application running in Wave wants to use your location information, even in the background.",
            NSCameraUsageDescription: "A CLI application running in Wave wants to use the camera.",
            NSMicrophoneUsageDescription: "A CLI application running in Wave wants to use your microphone.",
            NSCalendarsUsageDescription: "A CLI application running in Wave wants to use Calendar data.",
            NSLocationUsageDescription: "A CLI application running in Wave wants to use your location information.",
            NSAppleEventsUsageDescription: "A CLI application running in Wave wants to use AppleScript.",
        },
    },
    linux: {
        artifactName: "${name}-${platform}-${arch}-${version}.${ext}",
        category: "TerminalEmulator",
        executableName: pkg.name,
        target: ["zip", "deb", "rpm", "snap", "AppImage", "pacman"],
        synopsis: pkg.description,
        description: null,
        desktop: {
            entry: {
                Name: pkg.productName,
                Comment: pkg.description,
                Keywords: "developer;terminal;emulator;",
                Categories: "Development;Utility;",
            },
        },
        executableArgs: ["--enable-features", "UseOzonePlatform", "--ozone-platform-hint", "auto"], // Hint Electron to use Ozone abstraction layer for native Wayland support
    },
    deb: {
        afterInstall: "build/deb-postinstall.tpl",
    },
    win: {
        target: windowsTargets,
        icon: windowsIconPath,
        signAndEditExecutable: windowsShouldEditExecutable,
        signtoolOptions: windowsShouldSign && {
            signingHashAlgorithms: ["sha256"],
            publisherName: "Command Line Inc",
            certificateSubjectName: "Command Line Inc",
            certificateSha1: process.env.SM_CODE_SIGNING_CERT_SHA1_HASH,
        },
    },
    nsis: {
        installerIcon: windowsIconPath,
        uninstallerIcon: windowsIconPath,
        installerHeaderIcon: windowsIconPath,
    },
    appImage: {
        license: "LICENSE",
    },
    snap: {
        base: "core22",
        confinement: "classic",
        allowNativeWayland: true,
        artifactName: "${name}_${version}_${arch}.${ext}",
    },
    rpm: {
        // this should remove /usr/lib/.build-id/ links which can conflict with other electron apps like slack
        fpm: ["--rpm-rpmbuild-define", "_build_id_links none"],
    },
    publish: {
        provider: "generic",
        url: "https://dl.waveterm.dev/releases-w2",
    },
    afterPack: (context) => {
        // This is a workaround to restore file permissions to the wavesrv binaries on macOS after packaging the universal binary.
        if (context.electronPlatformName === "darwin" && context.arch === Arch.universal) {
            const packageBinDir = path.resolve(
                context.appOutDir,
                `${pkg.productName}.app/Contents/Resources/app.asar.unpacked/dist/bin`
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
