// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { sendRpcCommand, sendRpcResponse } from "@/app/store/wshrpcutil-base";
import * as util from "@/util/util";

const notFoundLogMap = new Map<string, boolean>();

class RpcResponseHelper {
    client: WshClient;
    cmdMsg: RpcMessage;
    done: boolean;

    constructor(client: WshClient, cmdMsg: RpcMessage) {
        this.client = client;
        this.cmdMsg = cmdMsg;
        // if reqid is null, no response required
        this.done = cmdMsg.reqid == null;
    }

    getSource(): string {
        return this.cmdMsg?.source;
    }

    sendResponse(msg: RpcMessage) {
        if (this.done || util.isBlank(this.cmdMsg.reqid)) {
            return;
        }
        if (msg == null) {
            msg = {};
        }
        msg.resid = this.cmdMsg.reqid;
        msg.source = this.client.routeId;
        sendRpcResponse(msg);
        if (!msg.cont) {
            this.done = true;
            this.client.openRpcs.delete(this.cmdMsg.reqid);
        }
    }
}

class WshClient {
    routeId: string;
    openRpcs: Map<string, ClientRpcEntry> = new Map();

    constructor(routeId: string) {
        this.routeId = routeId;
    }

    wshRpcCall(command: string, data: any, opts: RpcOpts): Promise<any> {
        const msg: RpcMessage = {
            command: command,
            data: data,
            source: this.routeId,
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
        const rpcGen = sendRpcCommand(this.openRpcs, msg);
        if (rpcGen == null) {
            return null;
        }
        const respMsgPromise = rpcGen.next(true); // pass true to force termination of rpc after 1 response (not streaming)
        return respMsgPromise.then((msg: IteratorResult<any, void>) => {
            return msg.value;
        });
    }

    wshRpcStream(command: string, data: any, opts: RpcOpts): AsyncGenerator<any, void, boolean> {
        if (opts?.noresponse) {
            throw new Error("noresponse not supported for responsestream calls");
        }
        const msg: RpcMessage = {
            command: command,
            data: data,
            reqid: crypto.randomUUID(),
            source: this.routeId,
        };
        if (opts?.timeout) {
            msg.timeout = opts.timeout;
        }
        if (opts?.route) {
            msg.route = opts.route;
        }
        const rpcGen = sendRpcCommand(this.openRpcs, msg);
        return rpcGen;
    }

    async handleIncomingCommand(msg: RpcMessage) {
        // TODO implement a timeout (setTimeout + sendResponse)
        const helper = new RpcResponseHelper(this, msg);
        const handlerName = `handle_${msg.command}`;
        try {
            let result: any = null;
            let prtn: any = null;
            if (handlerName in this) {
                prtn = this[handlerName](helper, msg.data);
            } else {
                prtn = this.handle_default(helper, msg);
            }
            if (prtn instanceof Promise) {
                result = await prtn;
            } else {
                result = prtn;
            }
            if (!helper.done) {
                helper.sendResponse({ data: result });
            }
        } catch (e) {
            if (!helper.done) {
                helper.sendResponse({ error: e.message });
            } else {
                console.log(`rpc-client[${this.routeId}] command[${msg.command}] error`, e.message);
            }
        } finally {
            if (!helper.done) {
                helper.sendResponse({});
            }
        }
        return;
    }

    recvRpcMessage(msg: RpcMessage) {
        const isRequest = msg.command != null || msg.reqid != null;
        if (isRequest) {
            this.handleIncomingCommand(msg);
            return;
        }
        if (msg.resid == null) {
            console.log("rpc response missing resid", msg);
            return;
        }
        const entry = this.openRpcs.get(msg.resid);
        if (entry == null) {
            if (!notFoundLogMap.has(msg.resid)) {
                notFoundLogMap.set(msg.resid, true);
                console.log("rpc response generator not found", msg);
            }
            return;
        }
        entry.msgFn(msg);
    }

    async handle_message(helper: RpcResponseHelper, data: CommandMessageData): Promise<void> {
        console.log(`rpc:message[${this.routeId}]`, data?.message);
    }

    async handle_default(helper: RpcResponseHelper, msg: RpcMessage): Promise<void> {
        throw new Error(`rpc command "${msg.command}" not supported by [${this.routeId}]`);
    }
}

export { RpcResponseHelper, WshClient };
