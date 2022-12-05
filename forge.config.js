var AllowedFirstParts = {
    "package.json": true,
    "dist": true,
    "static": true,
    "node_modules": true,
    "bin": true,
};

var AllowedNodeModules = {
    "lzma-native": true,
    "fs-ext": true,
    "fsevents": true,
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
            "static/*",
            "node_modules/lzma-native/**",
            "node_modules/fs-ext/**",
            "node_modules/fsevents/**",
        ],
        icon: "static/PromptIcon.icns",
    },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
};
