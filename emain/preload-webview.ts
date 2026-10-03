// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from "electron";

document.addEventListener("contextmenu", (event) => {
    console.log("contextmenu event", event);
    if (event.target == null) {
        return;
    }
    const targetElement = event.target as HTMLElement;
    // Check if the right-click is on an image
    if (targetElement.tagName === "IMG") {
        setTimeout(() => {
            if (event.defaultPrevented) {
                return;
            }
            event.preventDefault();
            const imgElem = targetElement as HTMLImageElement;
            const imageUrl = imgElem.src;
            ipcRenderer.send("webview-image-contextmenu", { src: imageUrl });
        }, 50);
        return;
    }
    // do nothing
});

document.addEventListener("mouseup", (event) => {
    // Mouse button 3 = back, button 4 = forward
    if (!event.isTrusted) {
        return;
    }
    if (event.button === 3 || event.button === 4) {
        event.preventDefault();
        ipcRenderer.send("webview-mouse-navigate", event.button === 3 ? "back" : "forward");
    }
});

let tsunamiParentBlockId: string | null = null;

ipcRenderer.on("enable-tsunami-termlisten", (_event, parentBlockId: string) => {
    tsunamiParentBlockId = parentBlockId;
});

document.addEventListener("keydown", (event) => {
    if (!tsunamiParentBlockId) return;
    if (event.defaultPrevented) return;
    if ((event.metaKey || event.ctrlKey) && event.key === "Escape") {
        ipcRenderer.sendToHost("tsunami-key", { parentBlockId: tsunamiParentBlockId, key: "cmd-escape" });
        return;
    }
    if (!event.ctrlKey) return;
    if (event.key !== "c" && event.key !== "C" && event.key !== "z" && event.key !== "Z") return;
    const key = event.key.toLowerCase() === "c" ? "ctrl-c" : "ctrl-z";
    ipcRenderer.sendToHost("tsunami-key", { parentBlockId: tsunamiParentBlockId, key });
});

console.log("loaded wave preload-webview.ts");
