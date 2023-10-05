import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { WatchScreenPacketType } from "../types/types";
import dayjs from "dayjs";

class WSControl {
    wsConn: any;
    open: mobx.IObservableValue<boolean>;
    opening: boolean = false;
    reconnectTimes: number = 0;
    msgQueue: any[] = [];
    clientId: string;
    messageCallback: (any) => void = null;
    watchSessionId: string = null;
    watchScreenId: string = null;
    wsLog: mobx.IObservableArray<string> = mobx.observable.array([], { name: "wsLog" });
    authKey: string;
    baseHostPort: string;

    constructor(baseHostPort: string, clientId: string, authKey: string, messageCallback: (any) => void) {
        this.baseHostPort = baseHostPort;
        this.messageCallback = messageCallback;
        this.clientId = clientId;
        this.authKey = authKey;
        this.open = mobx.observable.box(false, { name: "WSOpen" });
        setInterval(this.sendPing, 5000);
    }

    log(str: string) {
        mobx.action(() => {
            let ts = dayjs().format("YYYY-MM-DD HH:mm:ss");
            this.wsLog.push("[" + ts + "] " + str);
            if (this.wsLog.length > 50) {
                this.wsLog.splice(0, this.wsLog.length - 50);
            }
        })();
    }

    @mobx.action
    setOpen(val: boolean) {
        mobx.action(() => {
            this.open.set(val);
        })();
    }

    connectNow(desc: string) {
        if (this.open.get()) {
            return;
        }
        this.log(sprintf("try reconnect (%s)", desc));
        this.opening = true;
        this.wsConn = new WebSocket(this.baseHostPort + "/ws?clientid=" + this.clientId);
        this.wsConn.onopen = this.onopen;
        this.wsConn.onmessage = this.onmessage;
        this.wsConn.onclose = this.onclose;
        // turns out onerror is not necessary (onclose always follows onerror)
        // this.wsConn.onerror = this.onerror;
    }

    reconnect(forceClose?: boolean) {
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
        let timeoutArr = [0, 0, 2, 5, 10, 10, 30, 60];
        let timeout = 60;
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
            this.reconnect();
        }
    }

    @boundMethod
    onopen() {
        this.log("connection open");
        this.setOpen(true);
        this.opening = false;
        this.runMsgQueue();
        this.sendWatchScreenPacket(true);
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
                console.log("[error] messageCallback", e);
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

    sendWatchScreenPacket(connect: boolean) {
        let pk: WatchScreenPacketType = {
            type: "watchscreen",
            connect: connect,
            sessionid: null,
            screenid: null,
            authkey: this.authKey,
        };
        if (this.watchSessionId != null) {
            pk.sessionid = this.watchSessionId;
        }
        if (this.watchScreenId != null) {
            pk.screenid = this.watchScreenId;
        }
        this.pushMessage(pk);
    }

    // these params can be null.  (null, null) means stop watching
    watchScreen(sessionId: string, screenId: string) {
        this.watchSessionId = sessionId;
        this.watchScreenId = screenId;
        this.sendWatchScreenPacket(false);
    }
}

export { WSControl };
