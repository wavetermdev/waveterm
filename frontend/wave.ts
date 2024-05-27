// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app";
import { loadFonts } from "./util/fontutil";
import { ClientService } from "@/bindings/clientservice";
import { Client } from "@/gopkg/wstore";
import { globalStore, atoms } from "@/store/global";
import * as WOS from "@/store/wos";
import * as wailsRuntime from "@wailsio/runtime";
import * as wstore from "@/gopkg/wstore";
import * as gdata from "@/store/global";
import { immerable } from "immer";

const urlParams = new URLSearchParams(window.location.search);
const windowId = urlParams.get("windowid");
const clientId = urlParams.get("clientid");

loadFonts();

console.log("Wave Starting");

document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOMContentLoaded");
    // ensures client/window are loaded into the cache before rendering
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
});
