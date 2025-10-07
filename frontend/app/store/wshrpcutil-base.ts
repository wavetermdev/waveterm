// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { wpsReconnectHandler } from "@/app/store/wps";
import { WshClient } from "@/app/store/wshclient";
import { WshRouter } from "@/app/store/wshrouter";
import { getWSServerEndpoint } from "@/util/endpoints";
import { addWSReconnectHandler, ElectronOverrideOpts, globalWS, initGlobalWS } from "./ws";

let DefaultRouter: WshRouter;

function setDefaultRouter(router: WshRouter) {
    DefaultRouter = router;
}

async function* rpcResponseGenerator(
    openRpcs: Map<string, ClientRpcEntry>,
    command: string,
    reqid: string,
    timeout: number
): AsyncGenerator<any, void, boolean> {
    const msgQueue: RpcMessage[] = [];
    let signalFn: () => void;
    let signalPromise = new Promise<void>((resolve) => (signalFn = resolve));
    let timeoutId: NodeJS.Timeout = null;
    if (timeout > 0) {
        timeoutId = setTimeout(() => {
            msgQueue.push({ resid: reqid, error: "EC-TIME: timeout waiting for response" });
            signalFn();
        }, timeout);
    }
    const msgFn = (msg: RpcMessage) => {
        msgQueue.push(msg);
        signalFn();
        // reset signal promise
        signalPromise = new Promise<void>((resolve) => (signalFn = resolve));
    };
    openRpcs.set(reqid, {
        reqId: reqid,
        startTs: Date.now(),
        command: command,
        msgFn: msgFn,
    });
    yield null;
    try {
        while (true) {
            while (msgQueue.length > 0) {
                const msg = msgQueue.shift()!;
                if (msg.error != null) {
                    throw new Error(msg.error);
                }
                if (!msg.cont && msg.data == null) {
                    return;
                }
                const shouldTerminate = yield msg.data;
                if (shouldTerminate) {
                    sendRpcCancel(reqid);
                    return;
                }
                if (!msg.cont) {
                    return;
                }
            }
            await signalPromise;
        }
    } finally {
        openRpcs.delete(reqid);
        if (timeoutId != null) {
            clearTimeout(timeoutId);
        }
    }
}

function sendRpcCancel(reqid: string) {
    const rpcMsg: RpcMessage = { reqid: reqid, cancel: true };
    DefaultRouter.recvRpcMessage(rpcMsg);
}

function sendRpcResponse(msg: RpcMessage) {
    DefaultRouter.recvRpcMessage(msg);
}

function sendRpcCommand(
    openRpcs: Map<string, ClientRpcEntry>,
    msg: RpcMessage
): AsyncGenerator<RpcMessage, void, boolean> {
    DefaultRouter.recvRpcMessage(msg);
    if (msg.reqid == null) {
        return null;
    }
    const rtnGen = rpcResponseGenerator(openRpcs, msg.command, msg.reqid, msg.timeout);
    rtnGen.next();
    return rtnGen;
}

async function consumeGenerator(gen: AsyncGenerator<any, any, any>) {
    let idx = 0;
    try {
        for await (const msg of gen) {
            console.log("gen", idx, msg);
            idx++;
        }
        const result = await gen.return(undefined);
        console.log("gen done", result.value);
    } catch (e) {
        console.log("gen error", e);
    }
}

if (globalThis.window != null) {
    globalThis["consumeGenerator"] = consumeGenerator;
}

function initElectronWshrpc(electronClient: WshClient, eoOpts: ElectronOverrideOpts) {
    setDefaultRouter(new WshRouter(new UpstreamWshRpcProxy()));
    const handleFn = (event: WSEventType) => {
        DefaultRouter.recvRpcMessage(event.data);
    };
    initGlobalWS(getWSServerEndpoint(), "electron", handleFn, eoOpts);
    globalWS.connectNow("connectWshrpc");
    DefaultRouter.registerRoute(electronClient.routeId, electronClient);
    addWSReconnectHandler(() => {
        DefaultRouter.reannounceRoutes();
    });
    addWSReconnectHandler(wpsReconnectHandler);
}

function shutdownWshrpc() {
    globalWS?.shutdown();
}

class UpstreamWshRpcProxy implements AbstractWshClient {
    recvRpcMessage(msg: RpcMessage): void {
        const wsMsg: WSRpcCommand = { wscommand: "rpc", message: msg };
        globalWS?.pushMessage(wsMsg);
    }
}

export { DefaultRouter, initElectronWshrpc, sendRpcCommand, sendRpcResponse, setDefaultRouter, shutdownWshrpc };
