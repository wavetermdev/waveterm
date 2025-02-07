// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ipcMain } from "electron";
import { getWebServerEndpoint } from "../frontend/util/endpoints";
import { fetch } from "../frontend/util/fetchutil";

const docsiteWebUrl = "https://docs.waveterm.dev/";
let docsiteUrl: string;

ipcMain.on("get-docsite-url", (event) => {
    event.returnValue = docsiteUrl;
});

export async function initDocsite() {
    const docsiteEmbeddedUrl = getWebServerEndpoint() + "/docsite/";
    try {
        const response = await fetch(docsiteEmbeddedUrl);
        if (response.ok) {
            console.log("Embedded docsite is running, using embedded version for help view");
            docsiteUrl = docsiteEmbeddedUrl;
        } else {
            console.log(
                "Embedded docsite is not running, using web version for help view",
                "status: " + response?.status
            );
            docsiteUrl = docsiteWebUrl;
        }
    } catch (error) {
        console.log("Failed to fetch docsite url, using web version for help view", error);
        docsiteUrl = docsiteWebUrl;
    }
}
