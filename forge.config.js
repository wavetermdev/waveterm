var AllowedFirstParts = {
    "package.json": true,
    dist: true,
    public: true,
    node_modules: true,
    bin: true,
};

var AllowedNodeModules = {
    // "lzma-native": true,
    // "fs-ext": true,
    // "fsevents": true,
    "monaco-editor": true,
};

var modCache = {};

function ignoreFn(path) {
    let parts = path.split("/");
    if (parts.length <= 1) {
        return false;
    }
    let firstPart = parts[1];
    if (!AllowedFirstParts[firstPart]) {
        return true;
    }
    if (firstPart == "node_modules") {
        if (parts.length <= 2) {
            return false;
        }
        if (parts.length > 3) {
            if (parts[3] == "build") {
                return true;
            }
        }
        let nodeModule = parts[2];
        if (!modCache[nodeModule]) {
            modCache[nodeModule] = true;
        }
        if (!AllowedNodeModules[nodeModule]) {
            return true;
        }
    }
    return false;
}

module.exports = {
    packagerConfig: {
        ignore: ignoreFn,
        files: [
            "package.json",
            "dist/*",
            "public/*",
            "node_modules/lzma-native/**",
            "node_modules/fs-ext/**",
            "node_modules/fsevents/**",
        ],
        icon: "public/waveterm.icns",
        osxNotarize: {
            tool: "notarytool",
            keychainProfile: "notarytool-creds",
        },
        osxSign: {
            "hardened-runtime": true,
            binaries: [
                "Contents/Resources/app/bin/wavesrv",
                "Contents/Resources/app/bin/mshell/mshell-v0.2-linux.amd64",
                "Contents/Resources/app/bin/mshell/mshell-v0.2-linux.arm64",
                "Contents/Resources/app/bin/mshell/mshell-v0.2-darwin.amd64",
                "Contents/Resources/app/bin/mshell/mshell-v0.2-darwin.arm64",
            ],
            identity: "VYQ48YC2N2",
        },
    },
    rebuildConfig: {},
    makers: [
        {
            name: "@electron-forge/maker-squirrel",
            config: {},
        },
        {
            name: "@electron-forge/maker-zip",
            platforms: ["darwin"],
        },
        {
            name: "@electron-forge/maker-deb",
            config: {},
        },
        {
            name: "@electron-forge/maker-rpm",
            config: {},
        },
    ],
};
