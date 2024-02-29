const pkg = require("./package.json");
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
                    bin: pkg.productName,
                    name: pkg.name,
                    genericName: "Terminal Emulator",
                    productName: pkg.productName,
                    productDescription: pkg.description,
                    icon: "public/waveterm.icns",
                    categories: ["Utility", "Development"],
                    maintainer: pkg.author,
                    homepage: pkg.homepage,
                    license: pkg.license,
                    version: pkg.version,
                },
            },
        },
        {
            name: "@electron-forge/maker-rpm",
            config: {
                options: {
                    bin: pkg.productName,
                    name: pkg.name,
                    genericName: "Terminal Emulator",
                    productName: pkg.productName,
                    description: pkg.description,
                    productDescription: pkg.description,
                    icon: "public/waveterm.icns",
                    categories: ["Utility", "Development"],
                    license: pkg.license,
                    version: pkg.version,
                },
            },
        },
        // {
        //     name: "@electron-forge/maker-flatpak",
        //     config: {
        //         options: {
        //             bin: pkg.productName,
        //             mimeType: ["text/plain"],
        //         },
        //     },
        // },
        // {
        //     name: "@electron-forge/maker-snap",
        //     config: {
        //         features: {
        //             audio: true,
        //             mpris: "com.commandline.waveterm",
        //             webgl: true,
        //         },
        //     },
        // },
    ],
};
