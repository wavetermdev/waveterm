// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as jotai from "jotai";
import { sprintf } from "sprintf-js";

const MaxWebSocketSendSize = 1024 * 1024; // 1MB

type JotaiStore = {
    get: <Value>(atom: jotai.Atom<Value>) => Value;
    set: <Value>(atom: jotai.WritableAtom<Value, [Value], void>, value: Value) => void;
};

class WSControl {
    wsConn: any;
    open: jotai.WritableAtom<boolean, [boolean], void>;
    opening: boolean = false;
    reconnectTimes: number = 0;
    msgQueue: any[] = [];
    windowId: string;
    messageCallback: (any) => void = null;
    watchSessionId: string = null;
    watchScreenId: string = null;
    wsLog: string[] = [];
    authKey: string;
    baseHostPort: string;
    lastReconnectTime: number = 0;
    jotaiStore: JotaiStore;

    constructor(
        baseHostPort: string,
        jotaiStore: JotaiStore,
        windowId: string,
        authKey: string,
        messageCallback: (any) => void
    ) {
        this.baseHostPort = baseHostPort;
        this.messageCallback = messageCallback;
        this.windowId = windowId;
        this.authKey = authKey;
        this.open = jotai.atom(false);
        this.jotaiStore = jotaiStore;
        setInterval(this.sendPing.bind(this), 5000);
    }

    log(str: string) {
        let ts = Date.now();
        this.wsLog.push("[" + ts + "] " + str);
        if (this.wsLog.length > 50) {
            this.wsLog.splice(0, this.wsLog.length - 50);
        }
    }

    setOpen(val: boolean) {
        this.jotaiStore.set(this.open, val);
    }

    isOpen() {
        return this.jotaiStore.get(this.open);
    }

    connectNow(desc: string) {
        if (this.isOpen()) {
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
        if (this.isOpen()) {
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
        let timeoutArr = [0, 0, 2, 5, 10, 10, 30, 60];
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
        if (this.isOpen() || this.opening) {
            this.setOpen(false);
            this.opening = false;
            this.reconnect();
        }
    }

    onopen() {
        this.log("connection open");
        this.setOpen(true);
        this.opening = false;
        this.runMsgQueue();
        // reconnectTimes is reset in onmessage:hello
    }

    runMsgQueue() {
        if (!this.isOpen()) {
            return;
        }
        if (this.msgQueue.length == 0) {
            return;
        }
        let msg = this.msgQueue.shift();
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
        if (!this.isOpen()) {
            return;
        }
        this.wsConn.send(JSON.stringify({ type: "ping", stime: Date.now() }));
    }

    sendMessage(data: WSCommandType) {
        if (!this.isOpen()) {
            return;
        }
        let msg = JSON.stringify(data);
        const byteSize = new Blob([msg]).size;
        if (byteSize > MaxWebSocketSendSize) {
            console.log("ws message too large", byteSize, data.wscommand, msg.substring(0, 100));
            return;
        }
        this.wsConn.send(msg);
    }

    pushMessage(data: WSCommandType) {
        if (!this.isOpen()) {
            this.msgQueue.push(data);
            return;
        }
        this.sendMessage(data);
    }
}

export { WSControl };
