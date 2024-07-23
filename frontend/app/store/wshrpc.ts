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
    const wsMsg: WSRpcCommand = { wscommand: "rpc", message: msg };
    globalWS.pushMessage(wsMsg);
    if (msg.reqid == null) {
        return null;
    }
    const rtnGen = rpcResponseGenerator(msg.command, msg.reqid, msg.timeout);
    rtnGen.next(); // start the generator (run the initialization/registration logic, throw away the result)
    return rtnGen;
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

export { handleIncomingRpcMessage, sendRpcCommand };
