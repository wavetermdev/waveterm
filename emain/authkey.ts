// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint, getWSServerEndpoint } from "@/util/endpoints";
import { ipcMain } from "electron";

const AuthKeyHeader = "X-AuthKey";
export const AuthKeyEnv = "AUTH_KEY";
export const AuthKey = crypto.randomUUID();

console.log("authKey", AuthKey);

ipcMain.on("get-auth-key", (event) => {
    event.returnValue = AuthKey;
});

export function configureAuthKeyRequestInjection(session: Electron.Session) {
    const filter: Electron.WebRequestFilter = {
        urls: [`${getWebServerEndpoint()}/*`, `${getWSServerEndpoint()}/*`],
    };
    session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        details.requestHeaders[AuthKeyHeader] = AuthKey;
        callback({ requestHeaders: details.requestHeaders });
    });
}
