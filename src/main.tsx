import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import dayjs from 'dayjs'
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames"
import {TermWrap} from "./term";
import {getCurrentSession, getLineId, Session, newSession, getAllSessions, getCurrentSessionId} from "./session";
import type {SessionDataType, LineType, CmdDataType, RemoteType} from "./types";
import localizedFormat from 'dayjs/plugin/localizedFormat';

dayjs.extend(localizedFormat)

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

function getLineDateStr(ts : number) : string {
    let lineDate = new Date(ts);
    let nowDate = new Date();
    if (nowDate.getFullYear() != lineDate.getFullYear()) {
        return dayjs(lineDate).format("ddd L LTS");
    }
    else if (nowDate.getMonth() != lineDate.getMonth() || nowDate.getDate() != lineDate.getDate()) {
        let yesterdayDate = (new Date());
        yesterdayDate.setDate(yesterdayDate.getDate()-1);
        if (yesterdayDate.getMonth() == lineDate.getMonth() && yesterdayDate.getDate() == lineDate.getDate()) {
            return "Yesterday " + dayjs(lineDate).format("LTS");;
        }
        return dayjs(lineDate).format("ddd L LTS");
    }
    else {
        return dayjs(ts).format("LTS");
    }
}

@mobxReact.observer
class LineText extends React.Component<{line : LineType, session : Session}, {}> {
    render() {
        let line = this.props.line;
        let formattedTime = getLineDateStr(line.ts);
        return (
            <div className="line line-text">
                <div className="avatar">
                    S
                </div>
                <div className="line-content">
                    <div className="meta">
                        <div className="user">{line.userid}</div>
                        <div className="ts">{formattedTime}</div>
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
class LineCmd extends React.Component<{line : LineType, session : Session, changeSizeCallback? : (term : TermWrap) => void}, {}> {
    constructor(props) {
        super(props);
    }
    
    componentDidMount() {
        let {session, line} = this.props;
        let termElem = document.getElementById("term-" + getLineId(line));
        let termWrap = session.getTermWrapByLine(line);
        termWrap.changeSizeCallback = this.props.changeSizeCallback;
        termWrap.connectToElem(termElem);
        if (line.isnew) {
            setTimeout(() => this.scrollIntoView(), 100);
            line.isnew = false;
        }
    }

    scrollIntoView() {
        let lineElem = document.getElementById("line-" + getLineId(this.props.line));
        lineElem.scrollIntoView({block: "end"});
    }

    @boundMethod
    doRefresh() {
        let {session, line} = this.props;
        let termWrap = session.getTermWrapByLine(line);
        termWrap.reloadTerminal(true, 500);
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

    replaceHomePath(path : string, homeDir : string) : string {
        if (path == homeDir) {
            return "~";
        }
        if (path.startsWith(homeDir + "/")) {
            return "~" + path.substr(homeDir.length);
        }
        return path;
    }

    renderCmdText(cmd : CmdDataType, remote : RemoteType) : any {
        if (cmd == null) {
            return (
                <div className="metapart-mono cmdtext">
                    <span className="term-bright-green">(cmd not found)</span>
                </div>
            );
        }
        let promptStr = "";
        if (remote.remotevars.local) {
            promptStr = sprintf("%s@%s", remote.remotevars.remoteuser, "local")
        }
        else if (remote.remotevars.remotehost) {
            promptStr = sprintf("%s@%s", remote.remotevars.remoteuser, remote.remotevars.remotehost)
        }
        else {
            let host = remote.remotevars.host || "unknown";
            if (remote.remotevars.user) {
                promptStr = sprintf("%s@%s", remote.remotevars.user, host)
            }
            else {
                promptStr = host;
            }
        }
        let cwd = "(unknown)";
        if (cmd.remotestate && cmd.remotestate.cwd) {
            cwd = cmd.remotestate.cwd;
        }
        if (remote.remotevars.home) {
            cwd = this.replaceHomePath(cwd, remote.remotevars.home)
        }
        return (
            <div className="metapart-mono cmdtext">
                <span className="term-bright-green">[{promptStr} {cwd}]</span> {this.singleLineCmdText(cmd.cmdstr)}
            </div>
        );
    }
    
    render() {
        let {session, line} = this.props;
        let lineid = line.lineid.toString();
        let running = false;
        let detached = false;
        let rows = 0;
        let cols = 0;
        let termWrap = session.getTermWrapByLine(line);
        let renderVersion = termWrap.getRenderVersion();
        termWrap.resizeToContent();
        let termSize = termWrap.getSize();
        let formattedTime = getLineDateStr(line.ts);
        let cellHeightPx = 17;
        let totalHeight = cellHeightPx * termWrap.usedRows;
        let cmd : CmdDataType = session.getCmd(line.cmdid);
        let remote : RemoteType = null;
        if (cmd != null) {
            remote = session.getRemote(cmd.remoteid);
            running = (cmd.status == "running");
            detached = (cmd.status == "detached");
        }
        return (
            <div className="line line-cmd" id={"line-" + getLineId(line)}>
                <div className={cn("avatar",{"num4": lineid.length == 4}, {"num5": lineid.length >= 5}, {"running": running}, {"detached": detached})}>
                    {lineid}
                </div>
                <div className="line-content">
                    <div className="meta">
                        <div className="user" style={{display: "none"}}>{line.userid}</div>
                        <div className="ts">{formattedTime}</div>
                    </div>
                    <div className="meta">
                        <div className="metapart-mono" style={{display: "none"}}>
                            {line.cmdid}
                            <If condition={termSize.rows > 0}>({termSize.rows}x{termSize.cols})</If>
                            {termWrap.ptyPos} bytes, v{renderVersion}
                        </div>
                        {this.renderCmdText(cmd, remote)}
                    </div>
                    <div className={cn("terminal-wrapper", {"focus": termWrap.isFocused.get()})} style={{overflowY: "hidden"}}>
                        <div className="terminal" id={"term-" + getLineId(line)} data-cmdid={line.cmdid} style={{height: totalHeight}}></div>
                    </div>
                </div>
                <div onClick={this.doRefresh} className="button refresh-button has-background-black is-small">
                    <span className="icon"><i className="fa fa-refresh"/></span>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class Line extends React.Component<{line : LineType, session : Session, changeSizeCallback? : (term : TermWrap) => void}, {}> {
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
    historyIndex : mobx.IObservableValue<number> = mobx.observable.box(0, {name: "history-index"});
    modHistory : mobx.IObservableArray<string> = mobx.observable.array([""], {name: "mod-history"});
    elistener : any;

    componentDidMount() {
        this.elistener = this.handleKeyPress.bind(this);
        document.addEventListener("keypress", this.elistener);
    }

    componentWillUnmount() {
        document.removeEventListener("keypress", this.elistener);
    }

    handleKeyPress(event : any) {
        if (event.code == "KeyI" && event.metaKey) {
            let elem = document.getElementById("main-cmd-input");
            if (elem != null) {
                elem.focus();
            }
        }
    }

    @mobx.action @boundMethod
    onKeyDown(e : any) {
        mobx.action(() => {
            let {session} = this.props;
            let ctrlMod = e.getModifierState("Control") || e.getModifierState("Meta") || e.getModifierState("Shift");
            if (e.code == "Enter" && !ctrlMod) {
                e.preventDefault();
                setTimeout(() => this.doSubmitCmd(), 0);
                return;
            }
            if (e.code == "ArrowUp") {
                e.preventDefault();
                let hidx = this.historyIndex.get();
                hidx += 1;
                if (hidx > session.getNumHistoryItems()) {
                    hidx = session.getNumHistoryItems();
                }
                this.historyIndex.set(hidx);
                return;
            }
            if (e.code == "ArrowDown") {
                e.preventDefault();
                let hidx = this.historyIndex.get();
                hidx -= 1;
                if (hidx < 0) {
                    hidx = 0;
                }
                this.historyIndex.set(hidx);
                return;
            }
            // console.log(e.code, e.keyCode, e.key, event.which, ctrlMod, e);
        })();
    }

    @boundMethod
    clearCurLine() {
        mobx.action(() => {
            this.historyIndex.set(0);
            this.modHistory.clear();
            this.modHistory[0] = "";
        })();
    }

    @boundMethod
    getCurLine() : string {
        let {session} = this.props;
        let hidx = this.historyIndex.get();
        if (hidx < this.modHistory.length && this.modHistory[hidx] != null) {
            return this.modHistory[hidx];
        }
        let hitem = session.getHistoryItem(-hidx);
        if (hitem == null) {
            return "";
        }
        return hitem.cmdtext;
    }

    @boundMethod
    setCurLine(val : string) {
        let hidx = this.historyIndex.get();
        this.modHistory[hidx] = val;
    }

    @boundMethod
    onChange(e : any) {
        mobx.action(() => {
            this.setCurLine(e.target.value);
        })();
    }

    @boundMethod
    doSubmitCmd() {
        let {session, windowid} = this.props;
        let commandStr = this.getCurLine();
        let hitem = {cmdtext: commandStr};
        session.addToHistory(hitem);
        this.clearCurLine();
        session.submitCommand(windowid, commandStr);
    }
    
    render() {
        let curLine = this.getCurLine();
        return (
            <div className="box cmd-input has-background-black">
                <div className="cmd-input-context">
                    <div className="has-text-white">
                        <span className="bold term-bright-green">[mike@local ~]</span>
                    </div>
                </div>
                <div className="cmd-input-field field has-addons">
                    <div className="control cmd-quick-context">
                        <div className="button is-static">mike@local</div>
                    </div>
                    <div className="control cmd-input-control is-expanded">
                        <textarea id="main-cmd-input" value={curLine} onKeyDown={this.onKeyDown} onChange={this.onChange} className="input"></textarea>
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
class SessionView extends React.Component<{session : Session}, {}> {
    shouldFollow : mobx.IObservableValue<boolean> = mobx.observable.box(true);

    @boundMethod
    scrollHandler(event : any) {
        let target = event.target;
        let atBottom = (target.scrollTop + 30 > (target.scrollHeight - target.offsetHeight));
        mobx.action(() => this.shouldFollow.set(atBottom))();
    }

    @boundMethod
    changeSizeCallback(term : TermWrap) {
        if (this.shouldFollow.get()) {
            let session = this.props.session;
            let window = session.getActiveWindow();
            let lines = window.lines;
            if (lines == null) {
                return;
            }
            let lastLine = lines[lines.length-1];
            let lineElem = document.getElementById("line-" + getLineId(lastLine));
            setTimeout(() => lineElem.scrollIntoView({block: "end"}), 0);
        }
    }
    
    render() {
        let session = this.props.session;
        let window = session.getActiveWindow();
        if (window == null) {
            return <div className="session-view">(no active window {session.activeWindowId.get()})</div>;
        }
        if (session.loading.get() || window.linesLoading.get()) {
            return <div className="session-view">(loading)</div>;
        }
        let idx = 0;
        let line : LineType = null;
        return (
            <div className="session-view">
                <div className="lines" onScroll={this.scrollHandler}>
                    <For each="line" of={window.lines} index="idx">
                        <Line key={line.lineid} line={line} session={session} changeSizeCallback={this.changeSizeCallback}/>
                    </For>
                </div>
                <CmdInput session={session} windowid={window.windowid}/>
            </div>
        );
    }
}

@mobxReact.observer
class MainSideBar extends React.Component<{}, {}> {
    collapsed : mobx.IObservableValue<boolean> = mobx.observable.box(false);

    @boundMethod
    toggleCollapsed() {
        mobx.action(() => {
            this.collapsed.set(!this.collapsed.get());
        })();
    }

    handleSessionClick(sessionId : string) {
        console.log("click session", sessionId);
    }

    handleReload() {
        console.log("reload");
        window.api.relaunch();
    }
    
    render() {
        let curSessionId = getCurrentSessionId();
        let sessions = getAllSessions();
        let session : SessionDataType = null;
        return (
            <div className={cn("main-sidebar", {"collapsed": this.collapsed.get()})}>
                <div className="collapse-container">
                    <div className="arrow-container" onClick={this.toggleCollapsed}>
                        <If condition={!this.collapsed.get()}><i className="fa fa-arrow-left"/></If>
                        <If condition={this.collapsed.get()}><i className="fa fa-arrow-right"/></If>
                    </div>
                </div>
                <div className="menu">
                    <p className="menu-label">
                        Private Sessions
                    </p>
                    <ul className="menu-list">
                        <For each="session" of={sessions}>
                            <li key={session.sessionid}><a className={cn({"is-active": curSessionId == session.sessionid})} onClick={() => this.handleSessionClick(session.sessionid)}>#{session.name}</a></li>
                        </For>
                        <li className="new-session"><a className="new-session"><i className="fa fa-plus"/> New Session</a></li>
                    </ul>
                    <p className="menu-label">
                        Shared Sessions
                    </p>
                    <ul className="menu-list">
                        <li><a>#server-status</a></li>
                        <li><a className="activity">#bug-3458 <div className="tag is-link">3</div></a></li>
                        <li><a>#dev-build</a></li>
                        <li className="new-session"><a className="new-session"><i className="fa fa-plus"/> New Session</a></li>
                    </ul>
                    <p className="menu-label">
                        Direct Messages
                    </p>
                    <ul className="menu-list">
                        <li><a>
                            <i className="user-status status fa fa-circle"/>
                            <img className="avatar" src="https://i.pravatar.cc/48?img=4"/>
                            Mike S <span className="sub-label">you</span>
                        </a></li>
                        <li><a>
                            <i className="user-status status offline fa fa-circle"/>
                            <img className="avatar" src="https://i.pravatar.cc/48?img=8"/>                            
                            Matt P
                        </a></li>
                        <li><a>
                            <i className="user-status status offline fa fa-circle"/>
                            <img className="avatar" src="https://i.pravatar.cc/48?img=12"/>
                            Adam B
                        </a></li>
                        <li><a className="activity">
                            <i className="user-status status fa fa-circle"/>
                            <img className="avatar" src="https://i.pravatar.cc/48?img=5"/>
                            Michelle T <div className="tag is-link">2</div>
                        </a></li>
                    </ul>
                    <div className="spacer"></div>
                    <p className="menu-label">
                        Remotes
                    </p>
                    <ul className="menu-list">
                        <li><a><i className="status fa fa-circle"/>local</a></li>
                        <li><a><i className="status fa fa-circle"/>local-sudo</a></li>
                        <li><a><i className="status offline fa fa-circle"/>mike@app01.ec2</a></li>
                        <li><a><i className="status fa fa-circle"/>mike@test01.ec2</a></li>
                        <li><a><i className="status offline fa fa-circle"/>root@app01.ec2</a></li>
                    </ul>
                    <p className="menu-label relaunch" onClick={this.handleReload} style={{cursor: "pointer"}}>
                        Relaunch
                    </p>
                    <div className="bottom-spacer"></div>
                </div>
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
        let session = getCurrentSession();
        return (
            <div id="main">
                <h1 className="title scripthaus-logo-small">
                    <div className="title-cursor">&#9608;</div>
                    ScriptHaus
                </h1>
                <div className="main-content">
                    <MainSideBar/>
                    <SessionView session={session}/>
                </div>
            </div>
        );
    }
}


export {Main};

