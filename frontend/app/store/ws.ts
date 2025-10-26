// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { type WebSocket, newWebSocket } from "@/util/wsutil";
import debug from "debug";
import { sprintf } from "sprintf-js";

const AuthKeyHeader = "X-AuthKey";

const dlog = debug("wave:ws");

const WarnWebSocketSendSize = 1024 * 1024; // 1MB
const MaxWebSocketSendSize = 5 * 1024 * 1024; // 5MB
const reconnectHandlers: (() => void)[] = [];
const StableConnTime = 2000;

function addWSReconnectHandler(handler: () => void) {
    reconnectHandlers.push(handler);
}

function removeWSReconnectHandler(handler: () => void) {
    const index = this.reconnectHandlers.indexOf(handler);
    if (index > -1) {
        reconnectHandlers.splice(index, 1);
    }
}

type WSEventCallback = (arg0: WSEventType) => void;

type ElectronOverrideOpts = {
    authKey: string;
};

class WSControl {
    wsConn: WebSocket;
    open: boolean;
    opening: boolean = false;
    reconnectTimes: number = 0;
    msgQueue: any[] = [];
    routeId: string;
    messageCallback: WSEventCallback;
    watchSessionId: string = null;
    watchScreenId: string = null;
    wsLog: string[] = [];
    baseHostPort: string;
    lastReconnectTime: number = 0;
    eoOpts: ElectronOverrideOpts;
    noReconnect: boolean = false;
    onOpenTimeoutId: NodeJS.Timeout = null;

    constructor(
        baseHostPort: string,
        routeId: string,
        messageCallback: WSEventCallback,
        electronOverrideOpts?: ElectronOverrideOpts
    ) {
        this.baseHostPort = baseHostPort;
        this.messageCallback = messageCallback;
        this.routeId = routeId;
        this.open = false;
        this.eoOpts = electronOverrideOpts;
        setInterval(this.sendPing.bind(this), 5000);
    }

    shutdown() {
        this.noReconnect = true;
        this.wsConn.close();
    }

    connectNow(desc: string) {
        if (this.open || this.noReconnect) {
            return;
        }
        this.lastReconnectTime = Date.now();
        dlog("try reconnect:", desc);
        this.opening = true;
        this.wsConn = newWebSocket(
            this.baseHostPort + "/ws?routeid=" + this.routeId,
            this.eoOpts
                ? {
                      [AuthKeyHeader]: this.eoOpts.authKey,
                  }
                : null
        );
        this.wsConn.onopen = (e: Event) => {
            this.onopen(e);
        };
        this.wsConn.onmessage = (e: MessageEvent) => {
            this.onmessage(e);
        };
        this.wsConn.onclose = (e: CloseEvent) => {
            this.onclose(e);
        };
        // turns out onerror is not necessary (onclose always follows onerror)
        // this.wsConn.onerror = this.onerror;
    }

    reconnect(forceClose?: boolean) {
        if (this.noReconnect) {
            return;
        }
        if (this.open) {
            if (forceClose) {
                this.wsConn.close(); // this will force a reconnect
            }
            return;
        }
        this.reconnectTimes++;
        if (this.reconnectTimes > 20) {
            dlog("cannot connect, giving up");
            return;
        }
        const timeoutArr = [0, 0, 2, 5, 10, 10, 30, 60];
        let timeout = 60;
        if (this.reconnectTimes < timeoutArr.length) {
            timeout = timeoutArr[this.reconnectTimes];
        }
        if (Date.now() - this.lastReconnectTime < 500) {
            timeout = 1;
        }
        if (timeout > 0) {
            dlog(sprintf("sleeping %ds", timeout));
        }
        setTimeout(() => {
            this.connectNow(String(this.reconnectTimes));
        }, timeout * 1000);
    }

    onclose(event: CloseEvent) {
        // console.log("close", event);
        if (this.onOpenTimeoutId) {
            clearTimeout(this.onOpenTimeoutId);
        }
        if (event.wasClean) {
            dlog("connection closed");
        } else {
            dlog("connection error/disconnected");
        }
        if (this.open || this.opening) {
            this.open = false;
            this.opening = false;
            this.reconnect();
        }
    }

    onopen(e: Event) {
        dlog("connection open");
        this.open = true;
        this.opening = false;
        this.onOpenTimeoutId = setTimeout(() => {
            this.reconnectTimes = 0;
            dlog("clear reconnect times");
        }, StableConnTime);
        for (let handler of reconnectHandlers) {
            handler();
        }
        this.runMsgQueue();
    }

    runMsgQueue() {
        if (!this.open) {
            return;
        }
        if (this.msgQueue.length == 0) {
            return;
        }
        const msg = this.msgQueue.shift();
        this.sendMessage(msg);
        setTimeout(() => {
            this.runMsgQueue();
        }, 100);
    }

    onmessage(event: MessageEvent) {
        let eventData = null;
        if (event.data != null) {
            eventData = JSON.parse(event.data);
        }
        if (eventData == null) {
            return;
        }
        if (eventData.type == "ping") {
            this.wsConn.send(JSON.stringify({ type: "pong", stime: Date.now() }));
            return;
        }
        if (eventData.type == "pong") {
            // nothing
            return;
        }
        if (this.messageCallback) {
            try {
                this.messageCallback(eventData);
            } catch (e) {
                console.log("[error] messageCallback", e);
            }
        }
    }

    sendPing() {
        if (!this.open) {
            return;
        }
        this.wsConn.send(JSON.stringify({ type: "ping", stime: Date.now() }));
    }

    sendMessage(data: WSCommandType) {
        if (!this.open) {
            return;
        }
        const msg = JSON.stringify(data);
        const byteSize = new Blob([msg]).size;
        if (byteSize > MaxWebSocketSendSize) {
            console.log("ws message too large", byteSize, data.wscommand, msg.substring(0, 100));
            return;
        }
        if (byteSize > WarnWebSocketSendSize) {
            console.log("ws message large", byteSize, data.wscommand, msg.substring(0, 100));
        }
        this.wsConn.send(msg);
    }

    pushMessage(data: WSCommandType) {
        if (!this.open) {
            this.msgQueue.push(data);
            return;
        }
        this.sendMessage(data);
    }
}

let globalWS: WSControl;
function initGlobalWS(
    baseHostPort: string,
    routeId: string,
    messageCallback: WSEventCallback,
    electronOverrideOpts?: ElectronOverrideOpts
) {
    globalWS = new WSControl(baseHostPort, routeId, messageCallback, electronOverrideOpts);
}

function sendRawRpcMessage(msg: RpcMessage) {
    const wsMsg: WSRpcCommand = { wscommand: "rpc", message: msg };
    sendWSCommand(wsMsg);
}

function sendWSCommand(cmd: WSCommandType) {
    globalWS?.pushMessage(cmd);
}

export {
    WSControl,
    addWSReconnectHandler,
    globalWS,
    initGlobalWS,
    removeWSReconnectHandler,
    sendRawRpcMessage,
    sendWSCommand,
    type ElectronOverrideOpts,
};
