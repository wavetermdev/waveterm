import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import * as dayjs from 'dayjs'
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames"
import {GlobalWS} from "./ws";
import {TermWrap} from "./term";

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

@mobxReact.observer
class LineCmd extends React.Component<{line : LineType}, {}> {
    termWrap : TermWrap;

    constructor(props) {
        super(props);
        let {line, sessionid} = this.props;
        this.termWrap = new TermWrap(sessionid, line.cmdid);
    }
    
    componentDidMount() {
        let {line, sessionid} = this.props;
        let termElem = document.getElementById(this.getId());
        this.termWrap.connectToElem(termElem);
        this.termWrap.reloadTerminal(0);
        if (line.isnew) {
            setTimeout(() => {
                let lineElem = document.getElementById("line-" + this.getId());
                lineElem.scrollIntoView({block: "end"});
                mobx.action(() => {
                    line.isnew = false;
                })();
            }, 100);
            setTimeout(() => {
                this.termWrap.reloadTerminal(0);
            }, 1000);
        }
    }

    getId() : string {
        let {line} = this.props;
        return "cmd-" + line.lineid + "-" + line.cmdid;
    }

    @boundMethod
    doRefresh() {
        this.termWrap.reloadTerminal(500);
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
        let rows = 0;
        let cols = 0;
        let renderVersion = this.termWrap.getRenderVersion();
        this.termWrap.resizeToContent();
        let termSize = this.termWrap.getSize();
        return (
            <div className="line line-cmd" id={"line-" + this.getId()}>
                <div className={cn("avatar",{"num4": lineid.length == 4}, {"num5": lineid.length >= 5}, {"running": running})}>
                    {lineid}
                </div>
                <div className="line-content">
                    <div className="meta">
                        <div className="user">{line.userid}</div>
                        <div className="ts">{dayjs(line.ts).format("hh:mm:ss a")}</div>
                        <div className="cmdid">{line.cmdid} <If condition={termSize.rows > 0}>({termSize.rows}x{termSize.cols})</If> v{renderVersion}</div>
                        <div className="cmdtext">&gt; {this.singleLineCmdText(line.cmdtext)}</div>
                    </div>
                    <div className={cn("terminal-wrapper", {"focus": this.termWrap.isFocused.get()})}>
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

@mobxReact.observer
class Main extends React.Component<{sessionid : string}, {}> {
    constructor(props : any) {
        super(props);
    }

    render() {
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
