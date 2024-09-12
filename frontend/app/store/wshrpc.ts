// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWSServerEndpoint } from "@/util/endpoints";
import { WSControl } from "./ws";

type RpcEntry = {
    reqId: string;
    startTs: number;
    command: string;
    msgFn: (msg: RpcMessage) => void;
};

const openRpcs = new Map<string, RpcEntry>();

function wshServerRpcHelper_responsestream(
    command: string,
    data: any,
    opts: RpcOpts
): AsyncGenerator<any, void, boolean> {
    if (opts?.noresponse) {
        throw new Error("noresponse not supported for responsestream calls");
    }
    const msg: RpcMessage = {
        command: command,
        data: data,
        reqid: crypto.randomUUID(),
    };
    if (opts?.timeout) {
        msg.timeout = opts.timeout;
    }
    if (opts?.route) {
        msg.route = opts.route;
    }
    const rpcGen = sendRpcCommand(msg);
    return rpcGen;
}

function wshServerRpcHelper_call(command: string, data: any, opts: RpcOpts): Promise<any> {
    const msg: RpcMessage = {
        command: command,
        data: data,
    };
    if (!opts?.noresponse) {
        msg.reqid = crypto.randomUUID();
    }
    if (opts?.timeout) {
        msg.timeout = opts.timeout;
    }
    if (opts?.route) {
        msg.route = opts.route;
    }
    const rpcGen = sendRpcCommand(msg);
    if (rpcGen == null) {
        return null;
    }
    const respMsgPromise = rpcGen.next(true); // pass true to force termination of rpc after 1 response (not streaming)
    return respMsgPromise.then((msg: IteratorResult<any, void>) => {
        return msg.value;
    });
}

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
    const wsMsg: WSRpcCommand = { wscommand: "rpc", message: rpcMsg };
    sendWSCommand(wsMsg);
}

function sendRpcCommand(msg: RpcMessage): AsyncGenerator<RpcMessage, void, boolean> {
    const wsMsg: WSRpcCommand = { wscommand: "rpc", message: msg };
    sendWSCommand(wsMsg);
    if (msg.reqid == null) {
        return null;
    }
    const rtnGen = rpcResponseGenerator(msg.command, msg.reqid, msg.timeout);
    rtnGen.next(); // start the generator (run the initialization/registration logic, throw away the result)
    return rtnGen;
}

function sendRawRpcMessage(msg: RpcMessage) {
    const wsMsg: WSRpcCommand = { wscommand: "rpc", message: msg };
    sendWSCommand(wsMsg);
}

const notFoundLogMap = new Map<string, boolean>();

let rpcEventHandlerFn: (evt: WaveEvent) => void;

function setRpcEventHandlerFn(fn: (evt: WaveEvent) => void) {
    if (rpcEventHandlerFn) {
        throw new Error("wshrpc.setRpcEventHandlerFn called more than once");
    }
    rpcEventHandlerFn = fn;
}

function handleIncomingRpcMessage(event: WSEventType) {
    if (event.eventtype !== "rpc") {
        console.warn("unsupported ws event type:", event.eventtype, event);
    }
    const msg: RpcMessage = event.data;
    const isRequest = msg.command != null || msg.reqid != null;
    if (isRequest) {
        // handle events
        if (msg.command == "eventrecv") {
            rpcEventHandlerFn?.(msg.data);
            return;
        }
        if (msg.command == "message") {
            if (msg.data?.oref != null) {
                console.log("rpc:message", msg.data?.oref, msg.data?.message);
            } else {
                console.log("rpc:message", msg.data?.message);
            }
            return;
        }

        console.log("rpc command not supported", msg);
        return;
    }
    if (msg.resid == null) {
        console.log("rpc response missing resid", msg);
        return;
    }
    const entry = openRpcs.get(msg.resid);
    if (entry == null) {
        if (!notFoundLogMap.has(msg.resid)) {
            notFoundLogMap.set(msg.resid, true);
            console.log("rpc response generator not found", msg);
        }
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

let globalWS: WSControl;

function initWshrpc(windowId: string) {
    globalWS = new WSControl(getWSServerEndpoint(), windowId, handleIncomingRpcMessage);
    globalWS.connectNow("connectWshrpc");
}

function sendWSCommand(cmd: WSCommandType) {
    globalWS?.sendMessage(cmd);
}

export {
    handleIncomingRpcMessage,
    initWshrpc,
    sendRawRpcMessage,
    sendRpcCommand,
    sendWSCommand,
    setRpcEventHandlerFn,
    wshServerRpcHelper_call,
    wshServerRpcHelper_responsestream,
};
