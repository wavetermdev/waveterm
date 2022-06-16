import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import * as dayjs from 'dayjs'
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames"
import {TermWrap} from "./term";
import {getDefaultSession} from "./session";

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
class LineText extends React.Component<{line : LineType, session : Session}, {}> {
    render() {
        let line = this.props.line;
        return (
            <div className="line line-text">
                <div className="avatar">
                    S
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
class LineCmd extends React.Component<{line : LineType, session : Session}, {}> {
    constructor(props) {
        super(props);
    }
    
    componentDidMount() {
        let {session, line} = this.props;
        let termElem = document.getElementById(this.getId());
        let termWrap = session.getTermWrap(line);
        termWrap.connectToElem(termElem);
        if (line.isnew) {
            setTimeout(() => {
                let lineElem = document.getElementById("line-" + this.getId());
                lineElem.scrollIntoView({block: "end"});
                mobx.action(() => {
                    line.isnew = false;
                })();
            }, 100);
            setTimeout(() => {
                termWrap.reloadTerminal(0);
            }, 1000);
        }
    }

    getId() : string {
        let {line} = this.props;
        return "cmd-" + line.lineid + "-" + line.cmdid;
    }

    @boundMethod
    doRefresh() {
        let {session, line} = this.props;
        let termWrap = session.getTermWrap(line);
        termWrap.reloadTerminal(500);
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
        let {session, line} = this.props;
        let lineid = line.lineid.toString();
        let running = false;
        let rows = 0;
        let cols = 0;
        let termWrap = session.getTermWrap(line);
        let renderVersion = termWrap.getRenderVersion();
        termWrap.resizeToContent();
        let termSize = termWrap.getSize();
        return (
            <div className="line line-cmd" id={"line-" + this.getId()}>
                <div className={cn("avatar",{"num4": lineid.length == 4}, {"num5": lineid.length >= 5}, {"running": running})}>
                    {lineid}
                </div>
                <div className="line-content">
                    <div className="meta">
                        <div className="user">{line.userid}</div>
                        <div className="ts">{dayjs(line.ts).format("hh:mm:ss a")}</div>
                        <div className="metapart-mono">{line.cmdid} <If condition={termSize.rows > 0}>({termSize.rows}x{termSize.cols})</If> {termWrap.ptyPos} bytes, v{renderVersion}</div>
                        <div className="metapart-mono cmdtext">&gt; {this.singleLineCmdText(line.cmdtext)}</div>
                    </div>
                    <div className={cn("terminal-wrapper", {"focus": termWrap.isFocused.get()})}>
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
class Line extends React.Component<{line : LineType, session : Session}, {}> {
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
class CmdInput extends React.Component<{session : Session, windowid : string}, {}> {
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
        let {session, windowid} = this.props;
        let commandStr = this.curLine.get();
        mobx.action(() => {
            this.curLine.set("");
        })();
        session.submitCommand(windowid, commandStr);
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
class SessionView extends React.Component<{session : SessionType}, {}> {
    render() {
        let session = this.props.session;
        let window = session.getActiveWindow();
        let lines = window.lines;
        return (
            <div className="session-view">
                <div className="lines">
                    <For each="line" of={lines}>
                        <Line key={line.lineid} line={line} session={session}/>
                    </For>
                </div>
                <CmdInput session={session} windowid={window.windowid}/>
            </div>
        );
    }
}

@mobxReact.observer
class Main extends React.Component<{}, {}> {
    constructor(props : any) {
        super(props);
    }

    render() {
        let session = getDefaultSession();
        return (
            <div className="main">
                <h1 className="title scripthaus-logo-small">
                    <div className="title-cursor">&#9608;</div>
                    ScriptHaus
                </h1>
                <SessionView session={session}/>
            </div>
        );
    }
}


export {Main};
