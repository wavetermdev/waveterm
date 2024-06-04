// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Client } from "@/gopkg/wstore";
import * as WOS from "@/store/wos";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app";
import { loadFonts } from "./util/fontutil";

const urlParams = new URLSearchParams(window.location.search);
const windowId = urlParams.get("windowid");
const clientId = urlParams.get("clientid");

loadFonts();

console.log("Wave Starting");

(window as any).WOS = WOS;

function matchViewportSize() {
    document.body.style.width = window.visualViewport.width + "px";
    document.body.style.height = window.visualViewport.height + "px";
}

matchViewportSize();

document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOMContentLoaded");
    // ensures client/window/workspace are loaded into the cache before rendering
    await WOS.loadAndPinWaveObject<Client>(WOS.makeORef("client", clientId));
    const waveWindow = await WOS.loadAndPinWaveObject<WaveWindow>(WOS.makeORef("window", windowId));
    await WOS.loadAndPinWaveObject<Workspace>(WOS.makeORef("workspace", waveWindow.workspaceid));
    let reactElem = React.createElement(App, null, null);
    let elem = document.getElementById("main");
    let root = createRoot(elem);
    document.fonts.ready.then(() => {
        console.log("Wave First Render");
        root.render(reactElem);
    });
    const viewport = window.visualViewport;
    viewport.addEventListener("resize", matchViewportSize);
});
