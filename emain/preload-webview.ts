// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const { ipcRenderer } = require("electron");

document.addEventListener("contextmenu", (event) => {
    console.log("contextmenu event", event);
    if (event.target == null) {
        return;
    }
    const targetElement = event.target as HTMLElement;
    // Check if the right-click is on an image
    if (targetElement.tagName === "IMG") {
        const imgElem = targetElement as HTMLImageElement;
        const imageUrl = imgElem.src;
        ipcRenderer.send("save-image", { src: imageUrl });
    }
});

console.log("loaded wave preload-webview.ts");
