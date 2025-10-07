// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { wpsReconnectHandler } from "@/app/store/wps";
import { TabClient } from "@/app/store/tabrpcclient";
import { makeTabRouteId, WshRouter } from "@/app/store/wshrouter";
import { getWSServerEndpoint } from "@/util/endpoints";
import { addWSReconnectHandler, globalWS, initGlobalWS, WSControl } from "./ws";
import { DefaultRouter, setDefaultRouter } from "./wshrpcutil-base";

let TabRpcClient: TabClient;

function initWshrpc(tabId: string): WSControl {
    const router = new WshRouter(new UpstreamWshRpcProxy());
    setDefaultRouter(router);
    const handleFn = (event: WSEventType) => {
        DefaultRouter.recvRpcMessage(event.data);
    };
    initGlobalWS(getWSServerEndpoint(), tabId, handleFn);
    globalWS.connectNow("connectWshrpc");
    TabRpcClient = new TabClient(makeTabRouteId(tabId));
    DefaultRouter.registerRoute(TabRpcClient.routeId, TabRpcClient);
    addWSReconnectHandler(() => {
        DefaultRouter.reannounceRoutes();
    });
    addWSReconnectHandler(wpsReconnectHandler);
    return globalWS;
}

class UpstreamWshRpcProxy implements AbstractWshClient {
    recvRpcMessage(msg: RpcMessage): void {
        const wsMsg: WSRpcCommand = { wscommand: "rpc", message: msg };
        globalWS?.pushMessage(wsMsg);
    }
}

export { DefaultRouter, initWshrpc, TabRpcClient };
export { initElectronWshrpc, sendRpcCommand, sendRpcResponse, shutdownWshrpc } from "./wshrpcutil-base";
