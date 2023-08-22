import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { WebShareWSMessage } from "./types";
import dayjs from "dayjs";

class WebShareWSControl {
    wsConn: any;
    open: mobx.IObservableValue<boolean>;
    opening: boolean = false;
    reconnectTimes: number = 0;
    msgQueue: any[] = [];
    messageCallback: (any) => void = null;
    screenId: string = null;
    viewKey: string = null;
    wsUrl: string;
    closed: boolean;

    constructor(wsUrl: string, screenId: string, viewKey: string, messageCallback: (any) => void) {
        this.wsUrl = wsUrl;
        this.messageCallback = messageCallback;
        this.screenId = screenId;
        this.viewKey = viewKey;
        this.open = mobx.observable.box(false, { name: "WSOpen" });
        this.closed = true;
        setInterval(this.sendPing, 20000);
    }

    close(): void {
        this.closed = true;
        if (this.wsConn != null) {
            this.wsConn.close();
        }
    }

    log(str: string) {
        console.log("[wscontrol]", str);
    }

    @mobx.action
    setOpen(val: boolean) {
        mobx.action(() => {
            this.open.set(val);
        })();
    }

    connectNow(desc: string) {
        this.closed = false;
        if (this.open.get()) {
            return;
        }
        this.log(sprintf("try reconnect (%s)", desc));
        this.opening = true;
        this.wsConn = new WebSocket(this.wsUrl);
        this.wsConn.onopen = this.onopen;
        this.wsConn.onmessage = this.onmessage;
        this.wsConn.onclose = this.onclose;
        // turns out onerror is not necessary (onclose always follows onerror)
        // this.wsConn.onerror = this.onerror;
    }

    reconnect(forceClose?: boolean) {
        this.closed = false;
        if (this.open.get()) {
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
        let timeoutArr = [0, 0, 5, 5, 15, 30, 60, 300, 3600];
        let timeout = timeoutArr[timeoutArr.length - 1];
        if (this.reconnectTimes < timeoutArr.length) {
            timeout = timeoutArr[this.reconnectTimes];
        }
        if (timeout > 0) {
            this.log(sprintf("sleeping %ds", timeout));
        }
        setTimeout(() => {
            this.connectNow(String(this.reconnectTimes));
        }, timeout * 1000);
    }

    @boundMethod
    onclose(event: any) {
        // console.log("close", event);
        if (event.wasClean) {
            this.log("connection closed");
        } else {
            this.log("connection error/disconnected");
        }
        if (this.open.get() || this.opening) {
            this.setOpen(false);
            this.opening = false;
            if (!this.closed) {
                this.reconnect();
            }
        }
    }

    @boundMethod
    onopen() {
        this.log("connection open");
        this.setOpen(true);
        this.opening = false;
        this.runMsgQueue();
        this.sendWebShareInit();
        // reconnectTimes is reset in onmessage:hello
    }

    runMsgQueue() {
        if (!this.open.get()) {
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

    @boundMethod
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
                this.log("[error] messageCallback " + e);
            }
        }
    }

    @boundMethod
    sendPing() {
        if (!this.open.get()) {
            return;
        }
        this.wsConn.send(JSON.stringify({ type: "ping", stime: Date.now() }));
    }

    sendMessage(data: any) {
        if (!this.open.get()) {
            return;
        }
        this.wsConn.send(JSON.stringify(data));
    }

    pushMessage(data: any) {
        if (!this.open.get()) {
            this.msgQueue.push(data);
            return;
        }
        this.sendMessage(data);
    }

    sendWebShareInit() {
        let pk: WebShareWSMessage = { type: "webshare", screenid: this.screenId, viewkey: this.viewKey };
        this.pushMessage(pk);
    }
}

export { WebShareWSControl };
