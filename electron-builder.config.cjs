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
        arch: "universal",
      },
      {
        target: "dmg",
        arch: "universal",
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
    binaries: fs
      .readdirSync("dist/bin", { recursive: true, withFileTypes: true })
      .filter((f) => f.isFile() && (f.name.startsWith("wavesrv") || f.name.includes("darwin")))
      .map((f) => path.resolve(f.path, f.name)),
  },
  linux: {
    executableName: pkg.productName,
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
  appImage: {
    license: "LICENSE",
  },
  publish: {
    provider: "generic",
    url: "https://dl.waveterm.dev/releases-w2",
  },
};

module.exports = config;
