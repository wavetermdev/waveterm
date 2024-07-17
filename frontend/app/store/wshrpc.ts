// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalWS } from "./global";

type RpcEntry = {
    reqId: string;
    startTs: number;
    command: string;
    msgFn: (msg: RpcMessage) => void;
};

let openRpcs = new Map<string, RpcEntry>();

async function* rpcResponseGenerator(
    command: string,
    reqid: string,
    timeout: number
): AsyncGenerator<RpcMessage, void, boolean> {
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
    try {
        while (true) {
            while (msgQueue.length > 0) {
                const msg = msgQueue.shift()!;
                const shouldTerminate = yield msg;
                if (shouldTerminate || !msg.cont) {
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

function sendRpcCommand(msg: RpcMessage): AsyncGenerator<RpcMessage, void, boolean> {
    let wsMsg: WSRpcCommand = { wscommand: "rpc", message: msg };
    globalWS.pushMessage(wsMsg);
    if (msg.reqid == null) {
        return null;
    }
    return rpcResponseGenerator(msg.command, msg.reqid, msg.timeout);
}

function handleIncomingRpcMessage(msg: RpcMessage) {
    const isRequest = msg.command != null || msg.reqid != null;
    if (isRequest) {
        console.log("rpc request not supported", msg);
        return;
    }
    if (msg.resid == null) {
        console.log("rpc response missing resid", msg);
        return;
    }
    const entry = openRpcs.get(msg.resid);
    if (entry == null) {
        console.log("rpc response generator not found", msg);
        return;
    }
    entry.msgFn(msg);
}

export { handleIncomingRpcMessage, sendRpcCommand };
