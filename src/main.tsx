import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import dayjs from 'dayjs'
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames"
import {TermWrap} from "./term";
import type {SessionDataType, LineType, CmdDataType, RemoteType} from "./types";
import localizedFormat from 'dayjs/plugin/localizedFormat';
import {GlobalModel, Session, Cmd, Window, Screen, ScreenWindow} from "./model";

dayjs.extend(localizedFormat)

function getLineId(line : LineType) : string {
    return sprintf("%s-%s-%s", line.sessionid, line.windowid, line.lineid);
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
class LineText extends React.Component<{line : LineType}, {}> {
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
class LineCmd extends React.Component<{line : LineType}, {}> {
    constructor(props) {
        super(props);
    }
    
    componentDidMount() {
        let {line} = this.props;
        let model = GlobalModel;
        let cmd = model.getCmd(line);
        if (cmd != null) {
            let termElem = document.getElementById("term-" + getLineId(line));
            cmd.connectElem(termElem);
        }
    }

    componentWillUnmount() {
        let {line} = this.props;
        let model = GlobalModel;
        let cmd = model.getCmd(line);
        if (cmd != null) {
            cmd.disconnectElem();
        }
    }

    scrollIntoView() {
        let lineElem = document.getElementById("line-" + getLineId(this.props.line));
        lineElem.scrollIntoView({block: "end"});
    }

    @boundMethod
    doRefresh() {
        let model = GlobalModel;
        let cmd = model.getCmd(this.props.line);
        if (cmd != null) {
            cmd.reloadTerminal(500);
        }
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

    renderCmdText(cmd : Cmd, remote : RemoteType) : any {
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
        let remoteState = cmd.getRemoteState();
        if (remoteState && remoteState.cwd) {
            cwd = remoteState.cwd;
        }
        if (remote.remotevars.home) {
            cwd = this.replaceHomePath(cwd, remote.remotevars.home)
        }
        return (
            <div className="metapart-mono cmdtext">
                <span className="term-bright-green">[{promptStr} {cwd}]</span> {cmd.getSingleLineCmdText()}
            </div>
        );
    }
    
    render() {
        let {line} = this.props;
        let model = GlobalModel;
        let lineid = line.lineid.toString();
        let formattedTime = getLineDateStr(line.ts);
        let cmd = model.getCmd(line);
        if (cmd == null) {
            return <div className="line line-invalid">[cmd not found '{line.cmdid}']</div>;
        }
        let cellHeightPx = 17;
        let totalHeight = cellHeightPx * cmd.usedRows.get();
        let remote = model.getRemote(cmd.remoteId);
        let status = cmd.getStatus();
        let running = (status == "running");
        let detached = (status == "detached");
        let termOpts = cmd.getTermOpts();
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
                            ({termOpts.rows}x{termOpts.cols})
                        </div>
                        {this.renderCmdText(cmd, remote)}
                    </div>
                    <div className={cn("terminal-wrapper", {"focus": cmd.isFocused.get()})} style={{overflowY: "hidden"}}>
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
class CmdInput extends React.Component<{}, {}> {
    historyIndex : mobx.IObservableValue<number> = mobx.observable.box(0, {name: "history-index"});
    modHistory : mobx.IObservableArray<string> = mobx.observable.array([""], {name: "mod-history"});

    @mobx.action @boundMethod
    onKeyDown(e : any) {
        mobx.action(() => {
            let model = GlobalModel;
            let win = model.getActiveWindow();
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
                if (hidx > win.getNumHistoryItems()) {
                    hidx = win.getNumHistoryItems();
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
        let model = GlobalModel;
        let hidx = this.historyIndex.get();
        if (hidx < this.modHistory.length && this.modHistory[hidx] != null) {
            return this.modHistory[hidx];
        }
        let win = model.getActiveWindow();
        if (win == null) {
            return "";
        }
        let hitem = win.getHistoryItem(-hidx);
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
        let model = GlobalModel;
        let commandStr = this.getCurLine();
        let hitem = {cmdtext: commandStr};
        this.clearCurLine();
        model.submitCommand(commandStr);
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
class ScreenWindowView extends React.Component<{sw : ScreenWindow}, {}> {
    mutObs : any;

    scrollToBottom() {
        let elem = document.getElementById(this.getLinesId());
        let oldST = elem.scrollTop;
        elem.scrollTop = elem.scrollHeight;
        // console.log("scroll-elem", oldST, elem.scrollHeight, elem.scrollTop, elem.scrollLeft, elem);
    }
    
    @boundMethod
    scrollHandler(event : any) {
        let {sw} = this.props;
        let target = event.target;
        let atBottom = (target.scrollTop + 30 > (target.scrollHeight - target.offsetHeight));
        if (sw && sw.shouldFollow.get() != atBottom) {
            mobx.action(() => sw.shouldFollow.set(atBottom));
        }
        // console.log("scroll-handler>", atBottom, target.scrollTop, target.scrollHeight);
    }

    componentDidMount() {
        let elem = document.getElementById(this.getLinesId());
        if (elem == null) {
            return;
        }
        this.mutObs = new MutationObserver(this.handleDomMutation.bind(this));
        this.mutObs.observe(elem, {childList: true});
        elem.addEventListener("termresize", this.handleTermResize)
    }

    componentWillUnmount() {
        this.mutObs.disconnect();
    }

    handleDomMutation(mutations, mutObs) {
        let {sw} = this.props;
        if (sw && sw.shouldFollow.get()) {
            setTimeout(() => this.scrollToBottom(), 0);
        }
    }

    getWindow() : Window {
        let {sw} = this.props;
        return GlobalModel.getWindowById(sw.sessionId, sw.windowId);
    }

    getLinesId() {
        let {sw} = this.props;
        return "window-lines-" + sw.windowId;
    }

    @boundMethod
    handleTermResize(e : any) {
        let {sw} = this.props;
        if (sw && sw.shouldFollow.get()) {
            setTimeout(() => this.scrollToBottom(), 0);
        }
    }

    getWindowViewStyle() : any {
        return {width: "100%", height: "100%"};
    }

    renderError(message : string) {
        return (
            <div className="window-view" style={this.getWindowViewStyle()}>
                <div className="lines" onScroll={this.scrollHandler} id={this.getLinesId()}>
                    {message}
                </div>
            </div>
        );
    }
    
    render() {
        let {sw} = this.props;
        if (sw == null) {
            return this.renderError("(no screen window)");
        }
        let win = this.getWindow();
        if (!win.linesLoaded.get()) {
            return this.renderError("(loading)");
        }
        let idx = 0;
        let line : LineType = null;
        return (
            <div className="window-view" style={this.getWindowViewStyle()}>
                <div className="lines" onScroll={this.scrollHandler} id={this.getLinesId()}>
                    <For each="line" of={win.lines} index="idx">
                        <Line key={line.lineid} line={line}/>
                    </For>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class ScreenView extends React.Component<{screen : Screen}, {}> {
    render() {
        let {screen} = this.props;
        if (screen == null) {
            return (
                <div className="screen-view">
                    (no screen)
                </div>
            );
        }
        let sw = screen.getActiveSW();
        return (
            <div className="screen-view">
                <ScreenWindowView sw={sw}/>
            </div>
        );
    }
}

@mobxReact.observer
class ScreenTabs extends React.Component<{}, {}> {
    render() {
        let model = GlobalModel;
        let session = model.getActiveSession();
        if (session == null) {
            return null;
        }
        return (
            <div className="screen-tabs">
                tabs!
            </div>
        );
    }
}

@mobxReact.observer
class SessionView extends React.Component<{}, {}> {
    render() {
        let model = GlobalModel;
        let session = model.getActiveSession();
        if (session == null) {
            return <div className="session-view">(no active session)</div>;
        }
        let activeScreen = session.getActiveScreen();
        return (
            <div className="session-view">
                <ScreenView screen={activeScreen}/>
                <ScreenTabs/>
                <CmdInput/>
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

    render() {
        let model = GlobalModel;
        let curSessionId = model.curSessionId.get();
        let session : Session = null;
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
                        <If condition={!model.sessionListLoaded.get()}>
                            <li><a>(loading)</a></li>
                        </If>
                        <If condition={model.sessionListLoaded.get()}>
                            <For each="session" of={model.sessionList}>
                                <li key={session.sessionId}><a className={cn({"is-active": curSessionId == session.sessionId})} onClick={() => this.handleSessionClick(session.sessionId)}>#{session.name.get()}</a></li>
                            </For>
                            <li className="new-session"><a className="new-session"><i className="fa fa-plus"/> New Session</a></li>
                        </If>
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
        return (
            <div id="main">
                <h1 className="title scripthaus-logo-small">
                    <div className="title-cursor">&#9608;</div>
                    ScriptHaus
                </h1>
                <div className="main-content">
                    <MainSideBar/>
                    <SessionView/>
                </div>
            </div>
        );
    }
}


export {Main};

