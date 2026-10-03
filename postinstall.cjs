const fs = require("fs");
const path = require("path");

const skip =
    process.env.WAVETERM_SKIP_APP_DEPS === "1" || process.env.CF_PAGES === "1" || process.env.CF_PAGES === "true";

function copyExcalidrawAssets() {
    const fontsSource = path.join(__dirname, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
    const fontsDest = path.join(__dirname, "public/excalidraw/fonts");

    if (!fs.existsSync(fontsSource)) {
        console.log("postinstall: @excalidraw/excalidraw not installed, skipping font copy");
        return;
    }

    fs.mkdirSync(fontsDest, { recursive: true });
    fs.cpSync(fontsSource, fontsDest, { recursive: true });
    console.log("postinstall: copied excalidraw fonts to public/excalidraw/fonts/");
}

copyExcalidrawAssets();

if (skip) {
    console.log("postinstall: skipping electron-builder install-app-deps");
    process.exit(0);
}

import("child_process").then(({ execSync }) => {
    execSync("electron-builder install-app-deps", { stdio: "inherit" });
});
