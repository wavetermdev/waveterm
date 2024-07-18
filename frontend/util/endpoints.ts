import { getEnv } from "./getenv";
import { lazy } from "./util";

export const WebServerEndpointVarName = "WAVE_SERVER_WEB_ENDPOINT";
export const WSServerEndpointVarName = "WAVE_SERVER_WS_ENDPOINT";

export const getServerWebEndpoint = lazy(() => `http://${getEnv(WebServerEndpointVarName)}`);

export const getServerWSEndpoint = lazy(() => `ws://${getEnv(WSServerEndpointVarName)}`);
