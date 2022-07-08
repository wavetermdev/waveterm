import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";

declare var window : any;

class WSControl {
    wsConn : any;
    open : mobx.IObservableValue<boolean>;
    opening : boolean = false;
    reconnectTimes : number = 0;
    msgQueue : any[] = [];
    reqMap : Record<string, (dataPacket : any) => void> = {};
    
    constructor() {
        this.open = mobx.observable.box(false, {name: "WSOpen"});
        setInterval(this.sendPing, 5000);
    }

    @mobx.action
    setOpen(val : boolean) {
        this.open.set(val);
    }

    registerAndSendGetCmd(pk : any, callback : (dataPacket : any) => void) {
        if (pk.reqid) {
            this.reqMap[pk.reqid] = callback;
        }
        this.pushMessage(pk)
    }

    unregisterReq(reqid : string) {
        delete this.reqMap[reqid];
    }

    reconnect() {
        if (this.open.get()) {
            this.wsConn.close();
            return;
        }
        this.reconnectTimes++;
        if (this.reconnectTimes > 20) {
            console.log("websocket cannot connect, giving up");
            return;
        }
        let timeoutArr = [0, 0, 2, 5, 10, 10, 30, 60];
        let timeout = 60;
        if (this.reconnectTimes < timeoutArr.length) {
            timeout = timeoutArr[this.reconnectTimes];
        }
        if (timeout > 0) {
            console.log(sprintf("websocket reconnect(%d), sleep %ds", this.reconnectTimes, timeout));
        }
        setTimeout(() => {
            console.log(sprintf("websocket reconnect(%d)", this.reconnectTimes));
            this.opening = true;
            this.wsConn = new WebSocket("ws://localhost:8081/ws?clientid=" + window.ScriptHausClientId);
            this.wsConn.onopen = this.onopen;
            this.wsConn.onmessage = this.onmessage;
            this.wsConn.onerror = this.onerror;
            this.wsConn.onclose = this.onclose;
        }, timeout*1000);
    }

    @boundMethod
    onerror(event : any) {
        console.log("websocket error", event);
        if (this.open.get() || this.opening) {
            this.setOpen(false);
            this.opening = false;
            this.reconnect();
        }
    }

    @boundMethod
    onclose(event : any) {
        console.log("websocket closed", event);
        if (this.open.get() || this.opening) {
            this.setOpen(false);
            this.opening = false;
            this.reconnect();
        }
    }

    @boundMethod
    onopen() {
        console.log("websocket open");
        this.setOpen(true);
        this.opening = false;
        this.runMsgQueue();
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
    onmessage(event : any) {
        let eventData = null;
        if (event.data != null) {
            eventData = JSON.parse(event.data);
        }
        if (eventData == null) {
            return;
        }
        if (eventData.type == "ping") {
            this.wsConn.send(JSON.stringify({type: "pong", stime: Date.now()}));
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
        if (eventData.type == "cmddata") {
            let cb = this.reqMap[eventData.respid];
            if (!cb) {
                console.log(sprintf("websocket cmddata req=%s -- no callback", eventData.respid));
                return;
            }
            cb(eventData);
            return;
        }
        console.log("websocket message", eventData);
    }

    @boundMethod
    sendPing() {
        if (!this.open.get()) {
            return;
        }
        this.wsConn.send(JSON.stringify({type: "ping", stime: Date.now()}));
    }

    sendMessage(data : any) {
        if (!this.open.get()) {
            return;
        }
        this.wsConn.send(JSON.stringify(data));
    }

    pushMessage(data : any) {
        if (!this.open.get()) {
            this.msgQueue.push(data);
            return;
        }
        this.sendMessage(data);
    }
}

var GlobalWS : WSControl;
if (window.GlobalWS == null) {
    GlobalWS = new WSControl();
    window.GlobalWS = GlobalWS;
}

export {GlobalWS};
