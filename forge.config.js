let AllowedFirstParts = {
    "package.json": true,
    dist: true,
    public: true,
    node_modules: true,
    bin: true,
};

let AllowedNodeModules = {
    "monaco-editor": true,
};

let modCache = {};

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
        if (nodeModule == "monaco-editor" && parts.length >= 4 && parts[3] != "min") {
            return true;
        }
    }
    return false;
}

const appName = "Wave";

module.exports = {
    packagerConfig: {
        ignore: ignoreFn,
        files: ["package.json", "dist/*", "public/*"],
        icon: "public/waveterm.icns",
    },
    rebuildConfig: {},
    makers: [
        {
            name: "@electron-forge/maker-zip",
            platforms: ["darwin", "linux"],
        },
        {
            name: "@electron-forge/maker-deb",
            config: {
                options: {
                    bin: appName,
                },
            },
        },
        {
            name: "@electron-forge/maker-rpm",
            config: {
                options: {
                    bin: appName,
                },
            },
        },
    ],
};
