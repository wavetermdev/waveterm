// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { App } from "@/app/app";
import {
    registerControlShiftStateUpdateHandler,
    registerElectronReinjectKeyHandler,
    registerGlobalKeys,
} from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import { FileService, ObjectService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { initWshrpc, TabRpcClient } from "@/app/store/wshrpcutil";
import { loadMonaco } from "@/app/view/codeeditor/codeeditor";
import { getLayoutModelForActiveTab } from "@/layout/index";
import {
    atoms,
    countersClear,
    countersPrint,
    getApi,
    globalStore,
    initGlobal,
    initGlobalWaveEventSubs,
    loadConnStatus,
    pushFlashError,
    subscribeToConnEvents,
} from "@/store/global";
import * as WOS from "@/store/wos";
import { loadFonts } from "@/util/fontutil";
import { setKeyUtilPlatform } from "@/util/keyutil";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

const platform = getApi().getPlatform();
const urlParams = new URLSearchParams(window.location.search);
const tabId = urlParams.get("tabid");
const windowId = urlParams.get("windowid");
const clientId = urlParams.get("clientid");
const shouldActivate = urlParams.get("activate");

console.log("Wave Starting");
console.log("tabid", tabId, "clientid", clientId, "windowid", windowId);

initGlobal({ tabId, clientId, windowId, platform, environment: "renderer" });

setKeyUtilPlatform(platform);

loadFonts();
(window as any).WOS = WOS;
(window as any).globalStore = globalStore;
(window as any).globalAtoms = atoms;
(window as any).RpcApi = RpcApi;
(window as any).isFullScreen = false;
(window as any).countersPrint = countersPrint;
(window as any).countersClear = countersClear;
(window as any).getLayoutModelForActiveTab = getLayoutModelForActiveTab;
(window as any).pushFlashError = pushFlashError;
(window as any).modalsModel = modalsModel;

document.title = `Wave Terminal`;

document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOMContentLoaded");

    // Init WPS event handlers
    const globalWS = initWshrpc(tabId);
    (window as any).globalWS = globalWS;
    (window as any).TabRpcClient = TabRpcClient;
    await loadConnStatus();
    initGlobalWaveEventSubs();
    subscribeToConnEvents();

    // ensures client/window/workspace are loaded into the cache before rendering
    const client = await WOS.loadAndPinWaveObject<Client>(WOS.makeORef("client", clientId));
    const waveWindow = await WOS.loadAndPinWaveObject<WaveWindow>(WOS.makeORef("window", windowId));
    await WOS.loadAndPinWaveObject<Workspace>(WOS.makeORef("workspace", waveWindow.workspaceid));
    const initialTab = await WOS.loadAndPinWaveObject<Tab>(WOS.makeORef("tab", tabId));
    await WOS.loadAndPinWaveObject<LayoutState>(WOS.makeORef("layout", initialTab.layoutstate));
    document.title = `Wave Terminal - ${initialTab.name}`; // TODO update with tab name change

    registerGlobalKeys();
    registerElectronReinjectKeyHandler();
    registerControlShiftStateUpdateHandler();
    setTimeout(loadMonaco, 30);
    const fullConfig = await FileService.GetFullConfig();
    console.log("fullconfig", fullConfig);
    globalStore.set(atoms.fullConfigAtom, fullConfig);
    if (shouldActivate) {
        const prtn = ObjectService.SetActiveTab(tabId); // no need to wait
        prtn.catch((e) => {
            console.log("error on initial SetActiveTab", e);
        });
    }
    const reactElem = createElement(App, null, null);
    const elem = document.getElementById("main");
    const root = createRoot(elem);
    document.fonts.ready.then(() => {
        console.log("Wave First Render");
        root.render(reactElem);
    });
});
