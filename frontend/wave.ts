// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    registerControlShiftStateUpdateHandler,
    registerElectronReinjectKeyHandler,
    registerGlobalKeys,
} from "@/app/store/keymodel";
import { WshServer } from "@/app/store/wshserver";
import {
    atoms,
    countersClear,
    countersPrint,
    getApi,
    globalStore,
    globalWS,
    initGlobal,
    initWS,
    loadConnStatus,
    subscribeToConnEvents,
} from "@/store/global";
import * as services from "@/store/services";
import * as WOS from "@/store/wos";
import * as keyutil from "@/util/keyutil";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app";
import { loadFonts } from "./util/fontutil";

const platform = getApi().getPlatform();
const urlParams = new URLSearchParams(window.location.search);
const windowId = urlParams.get("windowid");
const clientId = urlParams.get("clientid");

console.log("Wave Starting");
console.log("clientid", clientId, "windowid", windowId);

initGlobal({ clientId, windowId, platform, environment: "renderer" });

keyutil.setKeyUtilPlatform(platform);

loadFonts();
(window as any).globalWS = globalWS;
(window as any).WOS = WOS;
(window as any).globalStore = globalStore;
(window as any).globalAtoms = atoms;
(window as any).WshServer = WshServer;
(window as any).isFullScreen = false;
(window as any).countersPrint = countersPrint;
(window as any).countersClear = countersClear;

document.title = `The Next Wave (${windowId.substring(0, 8)})`;

document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOMContentLoaded");
    // ensures client/window/workspace are loaded into the cache before rendering
    const client = await WOS.loadAndPinWaveObject<Client>(WOS.makeORef("client", clientId));
    const waveWindow = await WOS.loadAndPinWaveObject<WaveWindow>(WOS.makeORef("window", windowId));
    await WOS.loadAndPinWaveObject<Workspace>(WOS.makeORef("workspace", waveWindow.workspaceid));
    const initialTab = await WOS.loadAndPinWaveObject<Tab>(WOS.makeORef("tab", waveWindow.activetabid));
    await WOS.loadAndPinWaveObject<LayoutState>(WOS.makeORef("layout", initialTab.layoutstate));
    initWS();
    await loadConnStatus();
    subscribeToConnEvents();
    registerGlobalKeys();
    registerElectronReinjectKeyHandler();
    registerControlShiftStateUpdateHandler();
    const fullConfig = await services.FileService.GetFullConfig();
    console.log("fullconfig", fullConfig);
    globalStore.set(atoms.fullConfigAtom, fullConfig);
    services.ObjectService.SetActiveTab(waveWindow.activetabid); // no need to wait
    const reactElem = React.createElement(App, null, null);
    const elem = document.getElementById("main");
    const root = createRoot(elem);
    document.fonts.ready.then(() => {
        console.log("Wave First Render");
        root.render(reactElem);
    });
});
