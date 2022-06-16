import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {Terminal} from 'xterm';
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import * as dayjs from 'dayjs'
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames"

type LineType = {
    lineid : number,
    ts : number,
    userid : string,
    linetype : string,
    text : string,
    cmdid : string,
    cmdtext : string,
    isnew : boolean,
};

var GlobalLines = mobx.observable.box([
    {lineid: 1, userid: "sawka", ts: 1654631122000, linetype: "text", text: "hello"},
    {lineid: 2, userid: "sawka", ts: 1654631125000, linetype: "text", text: "again"},
]);

var GlobalWS : any = null;

var TermMap = {};
window.TermMap = TermMap;

function fetchJsonData(resp : any, ctErr : boolean) : Promise<any> {
    let contentType = resp.headers.get("Content-Type");
    if (contentType != null && contentType.startsWith("application/json")) {
        return resp.text().then((textData) => {
            try {
                return JSON.parse(textData);
            }
            catch (err) {
                let errMsg = sprintf("Unparseable JSON: " + err.message);
                let rtnErr = new Error(errMsg);
                throw rtnErr;
            }
        });
    }
    if (ctErr) {
        throw new Error("non-json content-type");
    }
}

function handleJsonFetchResponse(url : URL, resp : any) : Promise<any> {
    if (!resp.ok) {
        let errData = fetchJsonData(resp, false);
        if (errData && errData["error"]) {
            throw new Error(errData["error"])
        }
        let errMsg = sprintf("Bad status code response from fetch '%s': %d %s", url.toString(), resp.status, resp.statusText);
        let rtnErr = new Error(errMsg);
        throw rtnErr;
    }
    let rtnData = fetchJsonData(resp, true);
    return rtnData;
}

@mobxReact.observer
class LineMeta extends React.Component<{line : LineType}, {}> {
    render() {
        let line = this.props.line;
        return (
            <div className="meta">
                <div className="lineid">{line.lineid}</div>
                <div className="user">{line.userid}</div>
                <div className="ts">{dayjs(line.ts).format("hh:mm:ss a")}</div>
            </div>
        );
    }
}

@mobxReact.observer
class LineText extends React.Component<{line : LineType}, {}> {
    render() {
        let line = this.props.line;
        return (
            <div className="line line-text">
                <div className="avatar">
                    M
                </div>
                <div className="line-content">
                    <div className="meta">
                        <div className="user">{line.userid}</div>
                        <div className="ts">{dayjs(line.ts).format("hh:mm:ss a")}</div>
                    </div>
                    <div className="text">
                        {line.text}
                    </div>
                </div>
            </div>
        );
    }
}

function loadPtyOut(term : Terminal, sessionId : string, cmdId : string, callback?: () => void) {
    term.clear()
    let url = sprintf("http://localhost:8080/api/ptyout?sessionid=%s&cmdid=%s", sessionId, cmdId);
    fetch(url).then((resp) => {
        if (!resp.ok) {
            throw new Error(sprintf("Bad fetch response for /api/ptyout: %d %s", resp.status, resp.statusText));
        }
        return resp.text()
    }).then((resptext) => {
        setTimeout(() => term.write(resptext, callback), 0);
    });
}

@mobxReact.observer
class LineCmd extends React.Component<{line : LineType}, {}> {
    terminal : mobx.IObservableValue<Terminal> = mobx.observable.box(null, {name: "terminal"});
    focus : mobx.IObservableValue<boolean> = mobx.observable.box(false, {name: "focus"});
    version : mobx.IObservableValue<int> = mobx.observable.box(0, {name: "lineversion"});
    
    componentDidMount() {
        let {line, sessionid} = this.props;
        let terminal = new Terminal({rows: 2, cols: 80});
        TermMap[line.cmdid] = terminal;
        let termElem = document.getElementById(this.getId());
        terminal.open(termElem);
        mobx.action(() => this.terminal.set(terminal))();
        this.reloadTerminal();
        terminal.textarea.addEventListener("focus", () => {
            mobx.action(() => {
                this.focus.set(true);
            })();
        });
        terminal.textarea.addEventListener("blur", () => {
            mobx.action(() => {
                this.focus.set(false);
            })();
        });
        if (line.isnew) {
            setTimeout(() => {
                let lineElem = document.getElementById("line-" + this.getId());
                lineElem.scrollIntoView({block: "end"});
                mobx.action(() => {
                    line.isnew = false;
                })();
            }, 100);
            setTimeout(() => {
                this.reloadTerminal();
            }, 1000);
        }
    }

    reloadTerminal() {
        let {line, sessionid} = this.props;
        let terminal = this.terminal.get();
        loadPtyOut(terminal, sessionid, line.cmdid, this.incVersion);
    }

    @boundMethod
    incVersion() : void {
        mobx.action(() => this.version.set(this.version.get() + 1))();
    }

    getId() : string {
        let {line} = this.props;
        return "cmd-" + line.lineid + "-" + line.cmdid;
    }

    @boundMethod
    doRefresh() {
        this.reloadTerminal();
    }

    @boundMethod
    singleLineCmdText(cmdText : string) {
        if (cmdText == null) {
            return "(none)";
        }
        cmdText = cmdText.trim();
        let nlIdx = cmdText.indexOf("\n");
        if (nlIdx != -1) {
            cmdText = cmdText.substr(0, nlIdx) + "...";
        }
        if (cmdText.length > 80) {
            cmdText = cmdText.substr(0, 77) + "...";
        }
        return cmdText;
    }
    
    render() {
        let {line} = this.props;
        let lineid = line.lineid.toString();
        let running = false;
        let term = this.terminal.get();
        let version = this.version.get();
        let rows = 0;
        let cols = 0;
        if (term != null) {
            let termNumLines = term._core.buffer.lines.length;
            let termYPos = term._core.buffer.y;
            if (term.rows < 25 && termNumLines > term.rows) {
                term.resize(80, Math.min(25, termNumLines));
            } else if (term.rows < 25 && termYPos >= term.rows) {
                term.resize(80, Math.min(25, termYPos+1));
            }
            rows = term.rows;
            cols = term.cols;
        }
        return (
            <div className="line line-cmd" id={"line-" + this.getId()}>
                <div className={cn("avatar",{"num4": lineid.length == 4}, {"num5": lineid.length >= 5}, {"running": running})}>
                    {lineid}
                </div>
                <div className="line-content">
                    <div className="meta">
                        <div className="user">{line.userid}</div>
                        <div className="ts">{dayjs(line.ts).format("hh:mm:ss a")}</div>
                        <div className="cmdid">{line.cmdid} <If condition={rows > 0}>({rows}x{cols})</If> v{version}</div>
                        <div className="cmdtext">&gt; {this.singleLineCmdText(line.cmdtext)}</div>
                    </div>
                    <div className={cn("terminal-wrapper", {"focus": this.focus.get()})}>
                        <div className="terminal" id={this.getId()}></div>
                    </div>
                </div>
                <div>
                    <div onClick={this.doRefresh} className="button">Refresh</div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class Line extends React.Component<{line : LineType}, {}> {
    render() {
        let line = this.props.line;
        if (line.linetype == "text") {
            return <LineText {...this.props}/>;
        }
        if (line.linetype == "cmd") {
            return <LineCmd {...this.props}/>;
        }
        return <div className="line line-invalid">[invalid line type '{line.linetype}']</div>;
    }
}

@mobxReact.observer
class CmdInput extends React.Component<{line : LineType, sessionid : string}, {}> {
    curLine : mobx.IObservableValue<string> = mobx.observable("", {name: "command-line"});

    @mobx.action @boundMethod
    onKeyDown(e : any) {
        mobx.action(() => {
            let ctrlMod = e.getModifierState("Control") || e.getModifierState("Meta") || e.getModifierState("Shift");
            if (e.code == "Enter" && !ctrlMod) {
                e.preventDefault();
                setTimeout(() => this.doSubmitCmd(), 0);
                return;
            }
            // console.log(e.code, e.keyCode, e.key, event.which, ctrlMod, e);
        })();
    }

    @boundMethod
    onChange(e : any) {
        mobx.action(() => {
            this.curLine.set(e.target.value);
        })();
    }

    @boundMethod
    doSubmitCmd() {
        let commandStr = this.curLine.get();
        mobx.action(() => {
            this.curLine.set("");
        })();
        let url = sprintf("http://localhost:8080/api/run-command");
        let data = {sessionid: this.props.sessionid, command: commandStr};
        fetch(url, {method: "post", body: JSON.stringify(data)}).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            console.log("got success data", data);
            mobx.action(() => {
                let lines = GlobalLines.get();
                data.data.line.isnew = true;
                lines.push(data.data.line);
            })();
        }).catch((err) => {
            console.log("error calling run-command", err)
        });
    }
    
    render() {
        return (
            <div className="box cmd-input has-background-black">
                <div className="cmd-input-context">
                    <div className="has-text-white">
                        <span className="bold term-blue">[ mike@imac27 master ~/work/gopath/src/github.com/sawka/darktile-termutil ]</span>
                    </div>
                </div>
                <div className="cmd-input-field field has-addons">
                    <div className="control cmd-quick-context">
                        <div className="button is-static">mike@local</div>
                    </div>
                    <div className="control cmd-input-control is-expanded">
                        <textarea value={this.curLine.get()} onKeyDown={this.onKeyDown} onChange={this.onChange} className="input" type="text"></textarea>
                    </div>
                    <div className="control cmd-exec">
                        <div onClick={this.doSubmitCmd} className="button">
                            <span className="icon">
                                <i className="fa fa-rocket"/>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class SessionView extends React.Component<{sessionid : string}, {}> {
    render() {
        let lines = GlobalLines.get();
        return (
            <div className="session-view">
                <div className="lines">
                    <For each="line" of={lines}>
                        <Line key={line.lineid} line={line} sessionid={this.props.sessionid}/>
                    </For>
                </div>
                <CmdInput sessionid={this.props.sessionid}/>
            </div>
        );
    }
}

class WSControl {
    wsConn : any;
    openCallback : any;
    open : boolean;
    opening : boolean;
    reconnectTimes : int;
    
    constructor(openCallback : any) {
        this.reconnectTimes = 0;
        this.open = false;
        this.opening = false;
        this.openCallback = openCallback;
        setInterval(this.sendPing, 5000);
        this.reconnect();
    }

    reconnect() {
        if (this.open) {
            this.wsConn.close();
            return;
        }
        this.reconnectTimes++;
        let timeoutArr = [0, 0, 2, 5, 10, 10, 30, 60];
        let timeout = 60;
        if (this.reconnectTimes < timeoutArr.length) {
            timeout = timeoutArr[this.reconnectTimes];
        }
        if (timeout > 0 || true) {
            console.log(sprintf("websocket reconnect(%d), sleep %ds", this.reconnectTimes, timeout));
        }
        setTimeout(() => {
            console.log(sprintf("websocket reconnect(%d)", this.reconnectTimes));
            this.opening = true;
            this.wsConn = new WebSocket("ws://localhost:8081/ws");
            this.wsConn.onopen = this.onopen;
            this.wsConn.onmessage = this.onmessage;
            this.wsConn.onerror = this.onerror;
            this.wsConn.onclose = this.onclose;
        }, timeout*1000);
    }

    @boundMethod
    onerror(event : any) {
        console.log("websocket error", event);
        if (this.open || this.opening) {
            this.open = false;
            this.opening = false;
            this.reconnect();
        }
    }

    @boundMethod
    onclose(event : any) {
        console.log("websocket closed", event);
        if (this.open || this.opening) {
            this.open = false;
            this.opening = false;
            this.reconnect();
        }
    }

    @boundMethod
    onopen() {
        console.log("websocket open");
        this.open = true;
        this.opening = false;
        this.reconnectTimes = 0;
        if (this.openCallback != null) {
            this.openCallback();
        }
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
            this.wsConn.send(JSON.stringify({type: "pong", stime: parseInt(Date.now()/1000)}));
            return;
        }
        if (eventData.type == "pong") {
            // nothing
            return;
        }
        console.log("websocket message", event);
    }

    @boundMethod
    sendPing() {
        if (!this.open) {
            return;
        }
        this.wsConn.send(JSON.stringify({type: "ping", stime: Date.now()}));
    }

    sendMessage(data : any){
        if (!this.open) {
            return;
        }
        this.wsConn.send(JSON.stringify(data));
    }
}

@mobxReact.observer
class Main extends React.Component<{sessionid : string}, {}> {
    version : mobx.IObservableValue<int> = mobx.observable.box(false);
    
    constructor(props : any) {
        super(props);
        GlobalWS = new WSControl(this.updateVersion);
        window.GlobalWS = GlobalWS;
    }

    @boundMethod
    updateVersion() {
        mobx.action(() => this.version.set(this.version.get()+1))();
    }
    
    render() {
        let version = this.version.get();
        return (
            <div className="main">
                <h1 className="title scripthaus-logo-small">
                    <div className="title-cursor">&#9608;</div>
                    ScriptHaus
                </h1>
                <SessionView sessionid={this.props.sessionid}/>
            </div>
        );
    }
}


export {Main};
