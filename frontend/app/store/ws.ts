// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { sprintf } from "sprintf-js";

const MaxWebSocketSendSize = 1024 * 1024; // 1MB

type WSEventCallback = (arg0: WSEventType) => void;

class WSControl {
    wsConn: any;
    open: boolean;
    opening: boolean = false;
    reconnectTimes: number = 0;
    msgQueue: any[] = [];
    windowId: string;
    messageCallback: WSEventCallback;
    watchSessionId: string = null;
    watchScreenId: string = null;
    wsLog: string[] = [];
    baseHostPort: string;
    lastReconnectTime: number = 0;

    constructor(baseHostPort: string, windowId: string, messageCallback: WSEventCallback) {
        this.baseHostPort = baseHostPort;
        this.messageCallback = messageCallback;
        this.windowId = windowId;
        this.open = false;
        setInterval(this.sendPing.bind(this), 5000);
    }

    log(str: string) {
        const ts = Date.now();
        this.wsLog.push("[" + ts + "] " + str);
        if (this.wsLog.length > 50) {
            this.wsLog.splice(0, this.wsLog.length - 50);
        }
    }

    connectNow(desc: string) {
        if (this.open) {
            return;
        }
        this.lastReconnectTime = Date.now();
        this.log(sprintf("try reconnect (%s)", desc));
        this.opening = true;
        this.wsConn = new WebSocket(this.baseHostPort + "/ws?windowid=" + this.windowId);
        this.wsConn.onopen = this.onopen.bind(this);
        this.wsConn.onmessage = this.onmessage.bind(this);
        this.wsConn.onclose = this.onclose.bind(this);
        // turns out onerror is not necessary (onclose always follows onerror)
        // this.wsConn.onerror = this.onerror;
    }

    reconnect(forceClose?: boolean) {
        if (this.open) {
            if (forceClose) {
                this.wsConn.close(); // this will force a reconnect
            }
            return;
        }
        this.reconnectTimes++;
        if (this.reconnectTimes > 20) {
            this.log("cannot connect, giving up");
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
            this.log(sprintf("sleeping %ds", timeout));
        }
        setTimeout(() => {
            this.connectNow(String(this.reconnectTimes));
        }, timeout * 1000);
    }

    onclose(event: any) {
        // console.log("close", event);
        if (event.wasClean) {
            this.log("connection closed");
        } else {
            this.log("connection error/disconnected");
        }
        if (this.open || this.opening) {
            this.open = false;
            this.opening = false;
            this.reconnect();
        }
    }

    onopen() {
        this.log("connection open");
        this.open = true;
        this.opening = false;
        this.runMsgQueue();
        // reconnectTimes is reset in onmessage:hello
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

    onmessage(event: any) {
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
        if (eventData.type == "hello") {
            this.reconnectTimes = 0;
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

export { WSControl };
