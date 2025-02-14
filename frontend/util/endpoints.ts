// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getEnv } from "./getenv";
import { lazy } from "./util";

export const WebServerEndpointVarName = "WAVE_SERVER_WEB_ENDPOINT";
export const WSServerEndpointVarName = "WAVE_SERVER_WS_ENDPOINT";

export const getWebServerEndpoint = lazy(() => `http://${getEnv(WebServerEndpointVarName)}`);

export const getWSServerEndpoint = lazy(() => `ws://${getEnv(WSServerEndpointVarName)}`);
