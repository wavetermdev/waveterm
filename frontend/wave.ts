// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getApi, globalStore, globalWS, initWS } from "@/store/global";
import * as services from "@/store/services";
import * as WOS from "@/store/wos";
import * as keyutil from "@/util/keyutil";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app";
import { loadFonts } from "./util/fontutil";

const urlParams = new URLSearchParams(window.location.search);
let windowId = urlParams.get("windowid");
let clientId = urlParams.get("clientid");

console.log("Wave Starting");
console.log("clientid", clientId, "windowid", windowId);

keyutil.setKeyUtilPlatform(getApi().getPlatform());

loadFonts();
initWS();
(window as any).globalWS = globalWS;
(window as any).WOS = WOS;
(window as any).globalStore = globalStore;

function matchViewportSize() {
    document.body.style.width = window.visualViewport.width + "px";
    document.body.style.height = window.visualViewport.height + "px";
}

document.title = `The Next Wave (${windowId.substring(0, 8)})`;

matchViewportSize();

document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOMContentLoaded");
    // ensures client/window/workspace are loaded into the cache before rendering
    const client = await WOS.loadAndPinWaveObject<Client>(WOS.makeORef("client", clientId));
    const waveWindow = await WOS.loadAndPinWaveObject<WaveWindow>(WOS.makeORef("window", windowId));
    await WOS.loadAndPinWaveObject<Workspace>(WOS.makeORef("workspace", waveWindow.workspaceid));
    globalStore.set(atoms.settingsConfigAtom, await services.FileService.GetSettingsConfig());
    services.ObjectService.SetActiveTab(waveWindow.activetabid); // no need to wait
    const reactElem = React.createElement(App, null, null);
    const elem = document.getElementById("main");
    const root = createRoot(elem);
    document.fonts.ready.then(() => {
        console.log("Wave First Render");
        root.render(reactElem);
    });
    const viewport = window.visualViewport;
    viewport.addEventListener("resize", matchViewportSize);
});
