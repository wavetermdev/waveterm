// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import { getWebServerEndpoint, getWSServerEndpoint } from "../frontend/util/endpoints";

export const RemotePasswordHeader = "X-Remote-Password";

let injectedPassword: string | null = null;

export function setRemotePassword(p: string): void {
    injectedPassword = p;
}

export function getRemotePassword(): string | null {
    return injectedPassword;
}

export function configureRemotePasswordInjection(session: electron.Session): void {
    if (!injectedPassword) return;
    const filter: electron.WebRequestFilter = {
        urls: [`${getWebServerEndpoint()}/*`, `${getWSServerEndpoint()}/*`],
    };
    session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        details.requestHeaders[RemotePasswordHeader] = injectedPassword!;
        callback({ requestHeaders: details.requestHeaders });
    });
}
