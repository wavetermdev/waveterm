// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isPreviewWindow } from "@/app/store/windowtype";
import { getEnv } from "./getenv";
import { lazy } from "./util";

export const WebServerEndpointVarName = "WAVE_SERVER_WEB_ENDPOINT";
export const WSServerEndpointVarName = "WAVE_SERVER_WS_ENDPOINT";

export const getWebServerEndpoint = lazy(() => {
    if (isPreviewWindow()) return null;
    return `http://${getEnv(WebServerEndpointVarName)}`;
});

export const getWSServerEndpoint = lazy(() => {
    if (isPreviewWindow()) return null;
    return `ws://${getEnv(WSServerEndpointVarName)}`;
});
