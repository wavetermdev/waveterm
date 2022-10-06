import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {debounce} from "throttle-debounce";
import {v4 as uuidv4} from "uuid";
import dayjs from "dayjs";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames";
import {TermWrap} from "./term";
import type {SessionDataType, LineType, CmdDataType, RemoteType, RemoteStateType, RemoteInstanceType, RemotePtrType, HistoryItem, HistoryQueryOpts, RemoteEditType} from "./types";
import localizedFormat from 'dayjs/plugin/localizedFormat';
import {GlobalModel, GlobalCommandRunner, Session, Cmd, Window, Screen, ScreenWindow, riToRPtr, widthToCols, termWidthFromCols, termHeightFromRows} from "./model";

dayjs.extend(localizedFormat)

const RemotePtyRows = 8;
const RemotePtyCols = 80;
const PasswordUnchangedSentinel = "--unchanged--";

const RemoteColors = ["red", "green", "yellow", "blue", "magenta", "cyan", "white", "orange"];

type InterObsValue = {
    sessionid : string,
    windowid : string,
    lineid : string,
    cmdid : string,
    visible : mobx.IObservableValue<boolean>,
    timeoutid? : any,
};

let globalLineWeakMap = new WeakMap<any, InterObsValue>();

function isBlank(s : string) : boolean {
    return (s == null || s == "");
}

function windowLinesDOMId(windowid : string) {
    return "window-lines-" + windowid;
}

function scrollDiv(div : any, amt : number) {
    if (div == null) {
        return;
    }
    let newScrollTop = div.scrollTop + amt;
    if (newScrollTop < 0) {
        newScrollTop = 0;
    }
    div.scrollTo({top: newScrollTop, behavior: "smooth"});
}

function pageSize(div : any) : number {
    if (div == null) {
        return 300;
    }
    let size = div.clientHeight;
    if (size > 500) {
        size = size - 100;
    } else if (size > 200) {
        size = size - 30;
    }
    return size;
}

function interObsCallback(entries) {
    let now = Date.now();
    entries.forEach((entry) => {
        let line = globalLineWeakMap.get(entry.target);
        if ((line.timeoutid != null) && (line.visible.get() == entry.isIntersecting)) {
            clearTimeout(line.timeoutid);
            line.timeoutid = null;
            return;
        }
        if (line.visible.get() != entry.isIntersecting && line.timeoutid == null) {
            line.timeoutid = setTimeout(() => {
                line.timeoutid = null;
                mobx.action(() => {
                    line.visible.set(entry.isIntersecting);
                })();
            }, 250);
            return;
        }
    });
}

function getLineId(line : LineType) : string {
    return sprintf("%s-%s-%s", line.sessionid, line.windowid, line.lineid);
}

function makeFullRemoteRef(ownerName : string, remoteRef : string, name : string) : string {
    if (isBlank(ownerName) && isBlank(name)) {
        return remoteRef;
    }
    if (!isBlank(ownerName) && isBlank(name)) {
        return ownerName + ":" + remoteRef;
    }
    if (isBlank(ownerName) && !isBlank(name)) {
        return remoteRef + ":" + name;
    }
    return ownerName + ":" + remoteRef + ":" + name;
}

function getRemoteStr(rptr : RemotePtrType) : string {
    if (rptr == null || isBlank(rptr.remoteid)) {
        return "(invalid remote)";
    }
    let username = (isBlank(rptr.ownerid) ? null : GlobalModel.resolveUserIdToName(rptr.ownerid));
    let remoteRef = GlobalModel.resolveRemoteIdToRef(rptr.remoteid);
    let fullRef = makeFullRemoteRef(username, remoteRef, rptr.name);
    return fullRef;
}

function replaceHomePath(path : string, homeDir : string) : string {
    if (path == homeDir) {
        return "~";
    }
    if (path.startsWith(homeDir + "/")) {
        return "~" + path.substr(homeDir.length);
    }
    return path;
}

function getCwdStr(remote : RemoteType, state : RemoteStateType) : string {
    if ((state == null || state.cwd == null) && remote != null) {
        return "~";
    }
    let cwd = "(unknown)";
    if (state && state.cwd) {
        cwd = state.cwd;
    }
    if (remote && remote.remotevars.home) {
        cwd = replaceHomePath(cwd, remote.remotevars.home)
    }
    return cwd;
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
class LineText extends React.Component<{sw : ScreenWindow, line : LineType}, {}> {
    render() {
        let line = this.props.line;
        let formattedTime = getLineDateStr(line.ts);
        return (
            <div className="line line-text" data-lineid={line.lineid} data-windowid={line.windowid}>
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
class Prompt extends React.Component<{rptr : RemotePtrType, rstate : RemoteStateType}, {}> {
    render() {
        let remote : RemoteType = null;
        if (this.props.rptr && !isBlank(this.props.rptr.remoteid)) {
            remote = GlobalModel.getRemote(this.props.rptr.remoteid);
        }
        let remoteStr = getRemoteStr(this.props.rptr);
        let cwd = getCwdStr(remote, this.props.rstate);
        let isRoot = false;
        if (remote && remote.remotevars) {
            if (remote.remotevars["sudo"] || remote.remotevars["bestuser"] == "root") {
                isRoot = true;
            }
        }
        let className = (isRoot ? "term-bright-red" : "term-bright-green");
        return (
            <span className="term-bright-green">[{remoteStr}] {cwd} {isRoot ? "#" : "$"}</span>
        );
    }
}

@mobxReact.observer
class LineCmd extends React.Component<{sw : ScreenWindow, line : LineType, width : number, interObs : IntersectionObserver, initVis : boolean}, {}> {
    termLoaded : mobx.IObservableValue<boolean> = mobx.observable.box(false);
    lineRef : React.RefObject<any> = React.createRef();
    iobsVal : InterObsValue = null;
    autorunDisposer : () => void = null;
    
    constructor(props) {
        super(props);
        
        let line = props.line;
        let ival : InterObsValue = {
            sessionid: line.sessionid,
            windowid: line.windowid,
            lineid: line.lineid,
            cmdid: line.cmdid,
            visible: mobx.observable.box(this.props.initVis),
        };
        this.iobsVal = ival;
    }

    visibilityChanged(vis : boolean) : void {
        let curVis = this.termLoaded.get();
        if (vis && !curVis) {
            this.loadTerminal();
        }
        else if (!vis && curVis) {
            this.unloadTerminal();
        }
    }

    loadTerminal() : void {
        let {sw, line} = this.props;
        let model = GlobalModel;
        let cmd = model.getCmd(line);
        if (cmd == null) {
            return;
        }
        let termId = "term-" + getLineId(line);
        let termElem = document.getElementById(termId);
        if (termElem == null) {
            console.log("cannot load terminal, no term elem found", termId);
            return;
        }
        sw.connectElem(termElem, cmd, this.props.width);
        mobx.action(() => this.termLoaded.set(true))();
    }

    unloadTerminal() : void {
        let {sw, line} = this.props;
        let model = GlobalModel;
        let cmd = model.getCmd(line);
        if (cmd == null) {
            return;
        }
        let termId = "term-" + getLineId(line);
        sw.disconnectElem(line.cmdid);
        mobx.action(() => this.termLoaded.set(false))();
        let termElem = document.getElementById(termId);
        if (termElem != null) {
            termElem.replaceChildren();
        }
    }
    
    componentDidMount() {
        let {line} = this.props;
        if (this.lineRef.current == null || this.props.interObs == null) {
            console.log("LineCmd lineRef current is null or interObs is null", line, this.lineRef.current, this.props.interObs);
        }
        else {
            globalLineWeakMap.set(this.lineRef.current, this.iobsVal);
            this.props.interObs.observe(this.lineRef.current);
            this.autorunDisposer = mobx.autorun(() => {
                let vis = this.iobsVal.visible.get();
                this.visibilityChanged(vis);
            });
        }
    }

    componentWillUnmount() {
        let {sw, line} = this.props;
        let model = GlobalModel;
        if (this.termLoaded.get()) {
            sw.disconnectElem(line.cmdid);
        }
        if (this.lineRef.current != null && this.props.interObs != null) {
            this.props.interObs.unobserve(this.lineRef.current);
        }
        if (this.autorunDisposer != null) {
            this.autorunDisposer();
        }
    }

    scrollIntoView() {
        let lineElem = document.getElementById("line-" + getLineId(this.props.line));
        lineElem.scrollIntoView({block: "end"});
    }

    @boundMethod
    doRefresh() {
        let {sw, line} = this.props;
        let model = GlobalModel;
        let termWrap = sw.getTermWrap(line.cmdid);
        if (termWrap != null) {
            termWrap.reloadTerminal(500);
        }
    }

    renderCmdText(cmd : Cmd, remote : RemoteType) : any {
        if (cmd == null) {
            return (
                <div className="metapart-mono cmdtext">
                    <span className="term-bright-green">(cmd not found)</span>
                </div>
            );
        }
        let remoteStr = getRemoteStr(cmd.remote);
        let cwd = getCwdStr(remote, cmd.getRemoteState());
        return (
            <div className="metapart-mono cmdtext">
                <Prompt rptr={cmd.remote} rstate={cmd.getRemoteState()}/> {cmd.getSingleLineCmdText()}
            </div>
        );
    }

    @boundMethod
    clickTermBlock(e : any) {
        let {sw, line} = this.props;
        let model = GlobalModel;
        let termWrap = sw.getTermWrap(line.cmdid);
        if (termWrap != null) {
            termWrap.terminal.focus();
        }
    }
    
    render() {
        let {sw, line, width} = this.props;
        let model = GlobalModel;
        let lineid = line.lineid;
        let formattedTime = getLineDateStr(line.ts);
        let cmd = model.getCmd(line);
        if (cmd == null) {
            return (
                <div className="line line-invalid" id={"line-" + getLineId(line)} ref={this.lineRef}>
                    [cmd not found '{line.cmdid}']
                </div>
            );
        }
        let termLoaded = this.termLoaded.get();
        let usedRows = sw.getUsedRows(cmd, width);
        let termHeight = termHeightFromRows(usedRows);
        let remote = model.getRemote(cmd.remoteId);
        let status = cmd.getStatus();
        let termOpts = cmd.getTermOpts();
        let isFocused = sw.getIsFocused(line.cmdid);
        let lineNumStr = (line.linenumtemp ? "~" : "") + String(line.linenum);
        return (
            <div className={cn("line", "line-cmd", {"focus": isFocused})} id={"line-" + getLineId(line)} ref={this.lineRef} style={{position: "relative"}} data-lineid={line.lineid} data-windowid={line.windowid} data-cmdid={line.cmdid}>
                <div className="focus-indicator"/>
                <div className="line-header">
                    <div className={cn("avatar", "num-"+lineNumStr.length, "status-" + status, {"ephemeral": line.ephemeral})} onClick={this.doRefresh}>
                        {lineNumStr}
                        <If condition={status == "hangup" || status == "error"}>
                            <i className="fa fa-exclamation-triangle status-icon"/>
                        </If>
                        <If condition={status == "detached"}>
                            <i className="fa fa-refresh status-icon"/>
                        </If>
                    </div>
                    <div className="meta-wrap">
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
                    </div>
                </div>
                <div className={cn("terminal-wrapper", {"focus": isFocused})} style={{overflowY: "hidden"}}>
                    <If condition={!isFocused}>
                        <div className="term-block" onClick={this.clickTermBlock}></div>
                    </If>
                    <div className="terminal" id={"term-" + getLineId(line)} data-cmdid={line.cmdid} style={{height: termHeight}}></div>
                    <If condition={!termLoaded}><div style={{position: "absolute", top: 60, left: 30}}>(loading)</div></If>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class Line extends React.Component<{sw : ScreenWindow, line : LineType, width : number, interObs : IntersectionObserver, initVis : boolean}, {}> {
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
class TextAreaInput extends React.Component<{}, {}> {
    lastTab : boolean = false;
    lastHistoryUpDown : boolean = false;
    lastTabCurLine : mobx.IObservableValue<string> = mobx.observable.box(null);
    
    componentDidMount() {
        let input = document.getElementById("main-cmd-input");
        if (input != null) {
            input.focus();
        }
    }

    isModKeyPress(e : any) {
        return e.code.match(/^(Control|Meta|Alt|Shift)(Left|Right)$/);
    }

    getLinePos(elem : any) : {numLines : number, linePos : number} {
        let numLines = elem.value.split("\n").length;
        let linePos = elem.value.substr(0, elem.selectionStart).split("\n").length;
        return {numLines, linePos};
    }

    @mobx.action @boundMethod
    onKeyDown(e : any) {
        mobx.action(() => {
            if (this.isModKeyPress(e)) {
                return;
            }
            let model = GlobalModel;
            let inputModel = model.inputModel;
            let win = model.getActiveWindow();
            let ctrlMod = e.getModifierState("Control") || e.getModifierState("Meta") || e.getModifierState("Shift");
            let curLine = inputModel.getCurLine();
            
            let lastTab = this.lastTab;
            this.lastTab = (e.code == "Tab");
            let lastHist = this.lastHistoryUpDown;
            this.lastHistoryUpDown = false;
            
            if (e.code == "Tab") {
                e.preventDefault();
                if (lastTab) {
                    GlobalModel.submitCommand("compgen", null, [curLine], {"comppos": String(curLine.length), "compshow": "1", "nohist": "1"}, true);
                    return;
                }
                else {
                    GlobalModel.submitCommand("compgen", null, [curLine], {"comppos": String(curLine.length), "nohist": "1"}, true);
                    return;
                }
            }
            if (e.code == "Enter") {
                e.preventDefault();
                if (!ctrlMod) {
                    setTimeout(() => GlobalModel.inputModel.uiSubmitCommand(), 0);
                    return;
                }
                e.target.setRangeText("\n", e.target.selectionStart, e.target.selectionEnd, "end");
                GlobalModel.inputModel.setCurLine(e.target.value);
                return;
            }
            if (e.code == "Escape") {
                e.preventDefault();
                GlobalModel.inputModel.toggleInfoMsg();
                return;
            }
            if (e.code == "KeyC" && e.getModifierState("Control")) {
                e.preventDefault();
                inputModel.resetInput();
                return;
            }
            if (e.code == "KeyR" && e.getModifierState("Control")) {
                e.preventDefault();
                inputModel.openHistory();
                return;
            }
            if (e.code == "ArrowUp" || e.code == "ArrowDown") {
                if (!inputModel.isHistoryLoaded()) {
                    if (e.code == "ArrowUp") {
                        this.lastHistoryUpDown = true;
                        inputModel.loadHistory(false, 1, "window");
                    }
                    return;
                }
                // invisible history movement
                let linePos = this.getLinePos(e.target);
                if (e.code == "ArrowUp") {
                    if (!lastHist && linePos.linePos > 1) {
                        // regular arrow
                        return;
                    }
                    e.preventDefault();
                    inputModel.moveHistorySelection(1);
                    this.lastHistoryUpDown = true;
                    return;
                }
                if (e.code == "ArrowDown") {
                    if (!lastHist && linePos.linePos < linePos.numLines) {
                        // regular arrow
                        return;
                    }
                    e.preventDefault();
                    inputModel.moveHistorySelection(-1);
                    this.lastHistoryUpDown = true;
                    return;
                }
            }
            if (e.code == "PageUp" || e.code == "PageDown") {
                e.preventDefault();
                let infoScroll = inputModel.hasScrollingInfoMsg();
                if (infoScroll) {
                    let div = document.querySelector(".cmd-input-info");
                    let amt = pageSize(div);
                    scrollDiv(div, (e.code == "PageUp" ? -amt : amt));
                }
                else {
                    let win = GlobalModel.getActiveWindow();
                    if (win == null) {
                        return;
                    }
                    let id = windowLinesDOMId(win.windowId);
                    let div = document.getElementById(id);
                    let amt = pageSize(div);
                    scrollDiv(div, (e.code == "PageUp" ? -amt : amt));
                }
            }
            // console.log(e.code, e.keyCode, e.key, event.which, ctrlMod, e);
        })();
    }

    @boundMethod
    onChange(e : any) {
        mobx.action(() => {
            GlobalModel.inputModel.setCurLine(e.target.value);
        })();
    }

    @boundMethod
    onHistoryKeyDown(e : any) {
        let inputModel = GlobalModel.inputModel;
        if (e.code == "Escape") {
            e.preventDefault();
            inputModel.resetHistory();
            return;
        }
        if (e.code == "Enter") {
            e.preventDefault();
            inputModel.grabSelectedHistoryItem();
            return;
        }
        if (e.code == "KeyC" && e.getModifierState("Control")) {
            e.preventDefault();
            inputModel.resetInput();
            return;
        }
        if (e.code == "KeyM" && (e.getModifierState("Meta") || e.getModifierState("Control"))) {
            e.preventDefault();
            let opts = mobx.toJS(inputModel.historyQueryOpts.get());
            opts.includeMeta = !opts.includeMeta;
            inputModel.setHistoryQueryOpts(opts);
            return;
        }
        if (e.code == "KeyR" && ((e.getModifierState("Meta") || e.getModifierState("Control")) && !e.getModifierState("Shift"))) {
            console.log("meta-r");
            e.preventDefault();
            let opts = mobx.toJS(inputModel.historyQueryOpts.get());
            if (opts.limitRemote) {
                opts.limitRemote = false;
                opts.limitRemoteInstance = false;
            }
            else {
                opts.limitRemote = true;
                opts.limitRemoteInstance = true;
            }
            inputModel.setHistoryQueryOpts(opts);
            return;
        }
        if (e.code == "KeyS" && (e.getModifierState("Meta") || e.getModifierState("Control"))) {
            e.preventDefault();
            let opts = mobx.toJS(inputModel.historyQueryOpts.get());
            let htype = opts.queryType;
            if (htype == "window") {
                htype = "session";
            }
            else if (htype == "session") {
                htype = "global";
            }
            else {
                htype = "window";
            }
            inputModel.setHistoryType(htype);
            return;
        }
        if (e.code == "Tab") {
            e.preventDefault();
            return;
        }
        if (e.code == "ArrowUp" || e.code == "ArrowDown") {
            e.preventDefault();
            inputModel.moveHistorySelection(e.code == "ArrowUp" ? 1 : -1);
            return;
        }
        if (e.code == "PageUp" || e.code == "PageDown") {
            e.preventDefault();
            inputModel.moveHistorySelection(e.code == "PageUp" ? 10 : -10);
            return;
        }
    }

    @boundMethod
    handleHistoryInput(e : any) {
        let inputModel = GlobalModel.inputModel;
        mobx.action(() => {
            let opts = mobx.toJS(inputModel.historyQueryOpts.get());
            opts.queryStr = e.target.value;
            inputModel.setHistoryQueryOpts(opts);
        })();
    }

    @boundMethod
    handleMainFocus(e : any) {
        let inputModel = GlobalModel.inputModel;
        if (inputModel.historyShow.get()) {
            e.preventDefault();
            inputModel.giveFocus();
        }
        else {
            inputModel.setPhysicalInputFocused(true);
        }
    }

    @boundMethod
    handleMainBlur(e : any) {
        GlobalModel.inputModel.setPhysicalInputFocused(false);
    }

    @boundMethod
    handleHistoryFocus(e : any) {
        let inputModel = GlobalModel.inputModel;
        if (!inputModel.historyShow.get()) {
            e.preventDefault();
            inputModel.giveFocus();
        }
        else {
            inputModel.setPhysicalInputFocused(true);
        }
    }

    @boundMethod
    handleHistoryBlur(e : any) {
        GlobalModel.inputModel.setPhysicalInputFocused(false);
    }

    render() {
        let model = GlobalModel;
        let inputModel = model.inputModel;
        let curLine = inputModel.getCurLine();
        let numLines = curLine.split("\n").length;
        let displayLines = numLines;
        if (displayLines > 5) {
            displayLines = 5;
        }
        let disabled = inputModel.historyShow.get();
        if (disabled) {
            displayLines = 1;
        }
        return (
            <div className="control cmd-input-control is-expanded">
                <textarea spellCheck="false" id="main-cmd-input" onFocus={this.handleMainFocus} onBlur={this.handleMainBlur} rows={displayLines} value={curLine} onKeyDown={this.onKeyDown} onChange={this.onChange} className={cn("textarea", {"display-disabled": disabled})}></textarea>
                <input spellCheck="false" className="history-input" type="text" onFocus={this.handleHistoryFocus} onKeyDown={this.onHistoryKeyDown} onChange={this.handleHistoryInput} value={inputModel.historyQueryOpts.get().queryStr}/>
            </div>
        );
    }
}

@mobxReact.observer
class InfoRemoteShowAll extends React.Component<{}, {}> {
    clickRow(remoteId : string) : void {
        GlobalCommandRunner.showRemote(remoteId);
    }
    
    render() {
        let inputModel = GlobalModel.inputModel;
        let infoMsg = inputModel.infoMsg.get();
        if (infoMsg == null || !infoMsg.remoteshowall) {
            return null;
        }
        let remotes = GlobalModel.remotes ?? [];
        let remote : RemoteType = null;
        let idx : number = 0;
        remotes = sortAndFilterRemotes(remotes);
        return (
            <div className="info-remote-showall">
                <div className="info-title">
                    show all remotes
                </div>
                <table className="remotes-table">
                    <thead>
                        <tr>
                            <th>status</th>
                            <th>id</th>
                            <th>alias</th>
                            <th>user@host</th>
                            <th>connectmode</th>
                        </tr>
                    </thead>
                    <tbody>
                        <For each="remote" of={remotes}>
                            <tr key={remote.remoteid} onClick={() => this.clickRow(remote.remoteid)}>
                                <td className="status-cell">
                                    <div><RemoteStatusLight remote={remote}/>{remote.status}</div>
                                </td>
                                <td>
                                    {remote.remoteid.substr(0, 8)}
                                </td>
                                <td>
                                    {isBlank(remote.remotealias) ? "-" : remote.remotealias}
                                </td>
                                <td>
                                    {remote.remotecanonicalname}
                                </td>
                                <td>
                                    {remote.connectmode}
                                </td>
                            </tr>
                        </For>
                    </tbody>
                </table>
            </div>
        );
    }
}

@mobxReact.observer
class InfoRemoteShow extends React.Component<{}, {}> {
    getRemoteTypeStr(remote : RemoteType) : string {
        let mshellStr = "";
        if (!isBlank(remote.mshellversion)) {
            mshellStr = "mshell=" + remote.mshellversion;
        }
        if (!isBlank(remote.uname)) {
            if (mshellStr != "") {
                mshellStr += " ";
            }
            mshellStr += "uname=\"" + remote.uname + "\"";
        }
        if (mshellStr == "") {
            return remote.remotetype;
        }
        return remote.remotetype + " (" + mshellStr + ")";
    }

    @boundMethod
    connectRemote(remoteId : string) {
        GlobalCommandRunner.connectRemote(remoteId);
    }

    @boundMethod
    disconnectRemote(remoteId : string) {
        GlobalCommandRunner.disconnectRemote(remoteId);
    }

    @boundMethod
    installRemote(remoteId : string) {
        GlobalCommandRunner.installRemote(remoteId);
    }

    @boundMethod
    cancelInstall(remoteId : string) {
        GlobalCommandRunner.installCancelRemote(remoteId);
    }

    @boundMethod
    editRemote(remoteId : string) {
        GlobalCommandRunner.openEditRemote(remoteId);
    }

    renderConnectButton(remote : RemoteType) : any {
        if (remote.status == "connected" || remote.status == "connecting") {
            return <div onClick={() => this.disconnectRemote(remote.remoteid)} className="text-button disconnect-button">[disconnect remote]</div>
        }
        else {
            return <div onClick={() => this.connectRemote(remote.remoteid)} className="text-button connect-button">[connect remote]</div>
        }
    }

    renderEditButton(remote : RemoteType) : any {
        return <div onClick={() => this.editRemote(remote.remoteid)} className="text-button">[edit remote]</div>
    }

    renderInstallButton(remote : RemoteType) : any {
        if (remote.status == "connected" || remote.status == "connecting") {
            return "(must disconnect to install)";
        }
        if (remote.installstatus == "disconnected" || remote.installstatus == "error") {
            return <div key="run-install" onClick={() => this.installRemote(remote.remoteid)} className="text-button connect-button">[run install]</div>
        }
        if (remote.installstatus == "connecting") {
            return <div key="cancel-install" onClick={() => this.cancelInstall(remote.remoteid)} className="text-button disconnect-button">[cancel install]</div>
        }
        return null;
    }

    renderInstallStatus(remote : RemoteType) : any {
        let statusStr : string = null;
        if (remote.installstatus == "disconnected") {
            if (remote.needsmshellupgrade) {
                statusStr = "needs upgrade"
            }
        }
        else {
            statusStr = remote.installstatus;
        }
        if (statusStr == null) {
            return null;
        }
        let installButton = this.renderInstallButton(remote);
        return (
            <div key="install-status" className="remote-field">
                <div className="remote-field-def"> install-status</div>
                <div className="remote-field-val">
                    {statusStr}<If condition={installButton != null}> | {this.renderInstallButton(remote)}</If>
                </div>
            </div>
        );
    }

    @boundMethod
    clickTermBlock(e : any) {
        let inputModel = GlobalModel.inputModel;
        if (inputModel.remoteTermWrap != null) {
            inputModel.remoteTermWrap.terminal.focus();
        }
    }

    getCanonicalNameDisplayWithPort(remote : RemoteType) {
        if (isBlank(remote.remotevars.port) || remote.remotevars.port == "22") {
            return remote.remotecanonicalname;
        }
        return remote.remotecanonicalname + " (port " + remote.remotevars.port + ")";
    }
    
    render() {
        let inputModel = GlobalModel.inputModel;
        let infoMsg = inputModel.infoMsg.get();
        let ptyRemoteId = (infoMsg == null ? null : infoMsg.ptyremoteid);
        let isTermFocused = (inputModel.remoteTermWrap == null ? false : inputModel.remoteTermWrap.isFocused.get());
        let remote : RemoteType;
        if (ptyRemoteId != null) {
            remote = GlobalModel.getRemote(ptyRemoteId);
        }
        if (ptyRemoteId == null || remote == null) {
            return (
                <>
                    <div key="term" className="terminal-wrapper" style={{display: "none"}}>
                        <div key="terminal" className="terminal" id="term-remote"></div>
                    </div>
                </>
            );
        }
        return (
            <>
                <div key="info" className="info-remote">
                    <div key="title" className="info-title">
                        show remote [{remote.remotecanonicalname}]
                    </div>
                    <div key="remoteid" className="remote-field">
                        <div className="remote-field-def"> remoteid</div>
                        <div className="remote-field-val">{remote.remoteid} | {this.renderEditButton(remote)}</div>
                    </div>
                    <div key="type" className="remote-field">
                        <div className="remote-field-def"> type</div>
                        <div className="remote-field-val">{this.getRemoteTypeStr(remote)}</div>
                    </div>
                    
                    <div key="cname" className="remote-field">
                        <div className="remote-field-def"> canonicalname</div>
                        <div className="remote-field-val">{this.getCanonicalNameDisplayWithPort(remote)}</div>
                    </div>
                    <div key="alias" className="remote-field">
                        <div className="remote-field-def"> alias</div>
                        <div className="remote-field-val">{isBlank(remote.remotealias) ? "-" : remote.remotealias}</div>
                    </div>
                    <div key="cm" className="remote-field">
                        <div className="remote-field-def"> connectmode</div>
                        <div className="remote-field-val">{remote.connectmode}</div>
                    </div>
                    <div key="status" className="remote-field">
                        <div className="remote-field-def"> status</div>
                        <div className="remote-field-val"><RemoteStatusLight remote={remote}/>{remote.status} | {this.renderConnectButton(remote)}</div>
                    </div>
                    <If condition={!isBlank(remote.errorstr)}>
                        <div key="error" className="remote-field">
                            <div className="remote-field-def"> error</div>
                            <div className="remote-field-val">{remote.errorstr}</div>
                        </div>
                    </If>
                    {this.renderInstallStatus(remote)}
                    <If condition={!isBlank(remote.installerrorstr)}>
                        <div key="ierror" className="remote-field">
                            <div className="remote-field-def"> install error</div>
                            <div className="remote-field-val">{remote.installerrorstr}</div>
                        </div>
                    </If>
                </div>
                <div key="term" className={cn("terminal-wrapper", {"focus": isTermFocused}, (remote != null ? "status-" + remote.status : null))} style={{overflowY: "hidden", display: (ptyRemoteId == null ? "none" : "block"), width: termWidthFromCols(RemotePtyCols)}}>
                    <If condition={!isTermFocused}>
                        <div key="termblock" className="term-block" onClick={this.clickTermBlock}></div>
                    </If>
                    <If condition={inputModel.showNoInputMsg.get()}>
                        <div key="termtag" className="term-tag">input is only allowed while status is 'connecting'</div>
                    </If>
                    <div key="terminal" className="terminal" id="term-remote" data-remoteid={ptyRemoteId} style={{height: termHeightFromRows(RemotePtyRows)}}></div>
                </div>
            </>
        );
    }
}

@mobxReact.observer
class InfoRemoteEdit extends React.Component<{}, {}> {
    alias : mobx.IObservableValue<string>;
    hostName : mobx.IObservableValue<string>;
    keyStr : mobx.IObservableValue<string>;
    portStr : mobx.IObservableValue<string>;
    passwordStr : mobx.IObservableValue<string>;
    colorStr : mobx.IObservableValue<string>;
    connectMode : mobx.IObservableValue<string>;
    sudoBool : mobx.IObservableValue<boolean>;
    autoInstallBool : mobx.IObservableValue<boolean>;
    authMode : mobx.IObservableValue<string>;
    archiveConfirm : mobx.IObservableValue<boolean> = mobx.observable.box(false);

    constructor(props) {
        super(props);
        this.resetForm();
    }

    getEditAuthMode(redit : RemoteEditType) : string {
        if (!isBlank(redit.keystr) && redit.haspassword) {
            return "key+pw";
        }
        else if (!isBlank(redit.keystr)) {
            return "key";
        }
        else if (redit.haspassword) {
            return "pw";
        }
        else {
            return "none";
        }
    }

    resetForm() {
        let redit = this.getRemoteEdit();
        let remote = this.getEditingRemote();
        if (redit == null) {
            return;
        }
        let isEditMode = !isBlank(redit.remoteid);
        if (isEditMode && remote == null) {
            return;
        }

        // not editable
        this.hostName = mobx.observable.box("");
        this.portStr = mobx.observable.box("");
        this.sudoBool = mobx.observable.box(false);

        // editable
        if (isEditMode) {
            this.authMode = mobx.observable.box(this.getEditAuthMode(redit));
            this.alias = mobx.observable.box(remote.remotealias ?? "");
            this.passwordStr = mobx.observable.box(redit.haspassword ? PasswordUnchangedSentinel : "");
            this.keyStr = mobx.observable.box(redit.keystr ?? "");
            this.colorStr = mobx.observable.box(remote.remotevars["color"] ?? "");
            this.connectMode = mobx.observable.box(remote.connectmode);
            this.autoInstallBool = mobx.observable.box(remote.autoinstall);
        }
        else {
            this.authMode = mobx.observable.box("none");
            this.alias = mobx.observable.box("");
            this.passwordStr = mobx.observable.box("");
            this.keyStr = mobx.observable.box("");
            this.colorStr = mobx.observable.box("");
            this.connectMode = mobx.observable.box("startup");
            this.autoInstallBool = mobx.observable.box(true);
        }
    }

    canResetPw() : boolean {
        let redit = this.getRemoteEdit();
        if (redit == null) {
            return false;
        }
        return redit.haspassword && this.passwordStr.get() != PasswordUnchangedSentinel;
    }

    @boundMethod
    resetPw() : void {
        mobx.action(() => {
            this.passwordStr.set(PasswordUnchangedSentinel);
        })();
    }

    @boundMethod
    updateArchiveConfirm(e : any) : void {
        mobx.action(() => {
            this.archiveConfirm.set(e.target.checked);
        })();
    }

    @boundMethod
    doArchiveRemote(e : any) {
        e.preventDefault();
        if (!this.archiveConfirm.get()) {
            return;
        }
        let redit = this.getRemoteEdit();
        if (redit == null || isBlank(redit.remoteid)) {
            return;
        }
        GlobalCommandRunner.archiveRemote(redit.remoteid);
    }

    @boundMethod
    doSubmitRemote() {
        let redit = this.getRemoteEdit();
        let isEditing = !isBlank(redit.remoteid);
        let cname = this.hostName.get();
        let kwargs : Record<string, string> = {};
        let authMode = this.authMode.get();
        if (!isEditing) {
            if (this.sudoBool.get()) {
                kwargs["sudo"] = "1";
            }
        }
        kwargs["alias"] = this.alias.get();
        kwargs["color"] = this.colorStr.get();
        if (authMode == "key" || authMode == "key+pw") {
            kwargs["key"] = this.keyStr.get();
        }
        else {
            kwargs["key"] = "";
        }
        if (authMode == "pw" || authMode == "key+pw") {
            kwargs["password"] = this.passwordStr.get();
        }
        else {
            kwargs["password"] = ""
        }
        kwargs["connectmode"] = this.connectMode.get();
        kwargs["autoinstall"] = (this.autoInstallBool.get() ? "1" : "0");
        kwargs["visual"] = "1";
        kwargs["submit"] = "1";
        console.log("submit remote", (isEditing ? redit.remoteid : cname), kwargs);
        mobx.action(() => {
            if (isEditing) {
                GlobalCommandRunner.editRemote(redit.remoteid, kwargs);
            }
            else {
                GlobalCommandRunner.createRemote(cname, kwargs);
            }
        })();
    }

    @boundMethod
    doCancel() {
        mobx.action(() => {
            this.resetForm();
            GlobalModel.inputModel.clearInfoMsg(true);
        })();
    }

    @boundMethod
    keyDownCreateRemote(e : any) {
        if (e.code == "Enter") {
            this.doSubmitRemote();
        }
    }

    @boundMethod
    keyDownCancel(e : any) {
        if (e.code == "Enter") {
            this.doCancel();
        }
    }

    @boundMethod
    onChangeAlias(e : any) {
        mobx.action(() => {
            this.alias.set(e.target.value);
        })();
    }

    @boundMethod
    onChangeHostName(e : any) {
        mobx.action(() => {
            this.hostName.set(e.target.value);
        })();
    }

    @boundMethod
    onChangeKeyStr(e : any) {
        mobx.action(() => {
            this.keyStr.set(e.target.value);
        })();
    }

    @boundMethod
    onChangePortStr(e : any) {
        mobx.action(() => {
            this.portStr.set(e.target.value);
        })();
    }

    @boundMethod
    onChangePasswordStr(e : any) {
        mobx.action(() => {
            this.passwordStr.set(e.target.value);
        })();
    }

    @boundMethod
    onFocusPasswordStr(e : any) {
        if (this.passwordStr.get() == PasswordUnchangedSentinel) {
            e.target.select();
        }
    }

    @boundMethod
    onChangeColorStr(e : any) {
        mobx.action(() => {
            this.colorStr.set(e.target.value);
        })();
    }

    @boundMethod
    onChangeConnectMode(e : any) {
        mobx.action(() => {
            this.connectMode.set(e.target.value);
        })();
    }

    @boundMethod
    onChangeAuthMode(e : any) {
        mobx.action(() => {
            this.authMode.set(e.target.value);
        })();
    }

    @boundMethod
    onChangeSudo(e : any) {
        mobx.action(() => {
            this.sudoBool.set(e.target.checked);
        })();
    }

    @boundMethod
    onChangeAutoInstall(e : any) {
        mobx.action(() => {
            this.autoInstallBool.set(e.target.checked);
        })();
    }

    getRemoteEdit() : RemoteEditType {
        let inputModel = GlobalModel.inputModel;
        let infoMsg = inputModel.infoMsg.get();
        if (infoMsg == null) {
            return null;
        }
        return infoMsg.remoteedit;
    }

    getEditingRemote() : RemoteType {
        let inputModel = GlobalModel.inputModel;
        let infoMsg = inputModel.infoMsg.get();
        if (infoMsg == null) {
            return null;
        }
        let redit = infoMsg.remoteedit;
        if (redit == null || isBlank(redit.remoteid)) {
            return null;
        }
        let remote = GlobalModel.getRemote(redit.remoteid);
        return remote;
    }

    remoteCName() : string {
        let redit = this.getRemoteEdit();
        if (isBlank(redit.remoteid)) {
            // new-mode
            let hostName = this.hostName.get();
            if (hostName == "") {
                return "[no host]";
            }
            if (hostName.indexOf("@") == -1) {
                hostName = "[no user]@" + hostName;
            }
            if (!hostName.startsWith("sudo@") && this.sudoBool.get()) {
                return "sudo@" + hostName;
            }
            return hostName;
        }
        else {
            let remote = this.getEditingRemote();
            if (remote == null) {
                return "[no remote]";
            }
            return remote.remotecanonicalname;
        }
    }

    render() {
        let inputModel = GlobalModel.inputModel;
        let infoMsg = inputModel.infoMsg.get();
        if (infoMsg == null || !infoMsg.remoteedit) {
            return null;
        }
        let redit = infoMsg.remoteedit;
        if (!redit.remoteedit) {
            return null;
        }
        let isEditMode = !isBlank(redit.remoteid);
        let remote = this.getEditingRemote();
        if (isEditMode && remote == null) {
            return (
                <div className="info-title">cannot edit, remote {redit.remoteid} not found</div>
            );
        }
        let colorStr : string = null;
        return (
            <form className="info-remote">
                <div key="title" className="info-title">
                    <If condition={!isEditMode}>
                        add new remote '{this.remoteCName()}'
                    </If>
                    <If condition={isEditMode}>
                        edit remote '{this.remoteCName()}'
                    </If>
                </div>
                <div key="type" className="remote-input-field">
                    <div className="remote-field-label">type</div>
                    <div className="remote-field-control text-control">
                        ssh
                    </div>
                </div>
                <If condition={!isEditMode}>
                    <div key="hostname" className="remote-input-field">
                        <div className="remote-field-label">user@host</div>
                        <div className="remote-field-control text-input">
                            <input type="text" autoFocus={!isEditMode ? true : null} onChange={this.onChangeHostName} value={this.hostName.get()}/>
                        </div>
                    </div>
                    <div key="port" className="remote-input-field">
                        <div className="remote-field-label">port</div>
                        <div className="remote-field-control text-input">
                            <input type="number" placeholder="22" onChange={this.onChangePortStr} value={this.portStr.get()}/>
                        </div>
                    </div>
                </If>
                <If condition={isEditMode}>
                    <div key="hostname" className="remote-input-field">
                        <div className="remote-field-label">user@host</div>
                        <div className="remote-field-control text-control">
                            {remote.remotecanonicalname}
                            <If condition={remote.remotevars.port != "22"}>
            &nbsp;(port {remote.remotevars.port})
                            </If>
                        </div>
                    </div>
                </If>
                <div key="alias" className="remote-input-field">
                    <div className="remote-field-label">alias</div>
                    <div className="remote-field-control text-input">
                        <input type="text" autoFocus={isEditMode ? true : null} onChange={this.onChangeAlias} value={this.alias.get()}/>
                    </div>
                </div>
                <div key="auth" className="remote-input-field">
                    <div className="remote-field-label">authmode</div>
                    <div className="remote-field-control select-input">
                        <select onChange={this.onChangeAuthMode} value={this.authMode.get()}>
                            <option value="none">none</option>
                            <option value="key">keyfile</option>
                            <option value="pw">password</option>
                            <option value="key+pw">keyfile and password</option>
                        </select>
                    </div>
                </div>
                <If condition={this.authMode.get() == "key" || this.authMode.get() == "key+pw"}>
                    <div key="keyfile" className="remote-input-field">
                        <div className="remote-field-label">ssh keyfile</div>
                        <div className="remote-field-control text-input">
                            <input type="text" onChange={this.onChangeKeyStr} value={this.keyStr.get()}/>
                        </div>
                    </div>
                </If>
                <If condition={this.authMode.get() == "pw" || this.authMode.get() == "key+pw"}>
                    <div key="pw" className="remote-input-field">
                        <div className="remote-field-label">ssh password</div>
                        <div className="remote-field-control text-input">
                            <input type="password" onFocus={this.onFocusPasswordStr} onChange={this.onChangePasswordStr} value={this.passwordStr.get()}/>
                            <If condition={this.canResetPw()}>
                                <i onClick={this.resetPw} title="restore to original password" className="icon fa fa-undo undo-icon"/>
                            </If>
                        </div>
                    </div>
                </If>
                <div key="sudo" className="remote-input-field" style={{display: "none"}}>
                    <div className="remote-field-label">sudo</div>
                    <div className="remote-field-control checkbox-input">
                        <input type="checkbox" onChange={this.onChangeSudo} checked={this.sudoBool.get()}/>
                    </div>
                </div>
                <div key="cm" className="remote-input-field">
                    <div className="remote-field-label">connectmode</div>
                    <div className="remote-field-control select-input">
                        <select onChange={this.onChangeConnectMode} value={this.connectMode.get()}>
                            <option>startup</option>
                            <option>auto</option>
                            <option>manual</option>
                        </select>
                    </div>
                </div>
                <div key="ai" className="remote-input-field">
                    <div className="remote-field-label">autoinstall</div>
                    <div className="remote-field-control checkbox-input">
                        <input type="checkbox" onChange={this.onChangeAutoInstall} checked={this.autoInstallBool.get()}/>
                    </div>
                </div>
                <div key="color" className="remote-input-field">
                    <div className="remote-field-label">color</div>
                    <div className="remote-field-control select-input">
                        <select onChange={this.onChangeColorStr} value={this.colorStr.get()}>
                            <option value="">(default)</option>
                            <For each="colorStr" of={RemoteColors}>
                                <option key={colorStr} value={colorStr}>{colorStr}</option>
                            </For>
                        </select>
                    </div>
                </div>
                <If condition={!isBlank(redit.errorstr)}>
                    <div key="error" className="info-error">
                        {redit.errorstr}
                    </div>
                </If>
                <If condition={!isBlank(redit.infostr)}>
                    <div key="msg" className="info-msg">
                        {redit.infostr}
                    </div>
                </If>
                <div key="controls" style={{marginTop: 15, marginBottom: 10}} className="remote-input-field">
                    <a tabIndex={0} style={{marginRight: 20}} onClick={this.doSubmitRemote} onKeyDown={this.keyDownCreateRemote} className="text-button success-button">[{isEditMode ? "update" : "create"} remote]</a>
                    {"|"}
                    <a tabIndex={0} style={{marginLeft: 20, marginRight: 5}} onClick={this.doArchiveRemote} onKeyDown={this.keyDownCreateRemote} className={cn("text-button", (this.archiveConfirm.get() ? "error-button" : "disabled-button"))}>[archive remote]</a>
                    <input onChange={this.updateArchiveConfirm} checked={this.archiveConfirm.get()} style={{marginRight: 20}} type="checkbox"/>
                    {"|"}
                    <a tabIndex={0} style={{marginLeft: 20}} onClick={this.doCancel} onKeyDown={this.keyDownCancel} className="text-button grey-button">[cancel (ESC)]</a>
                </div>
            </form>
        );
    }
}

@mobxReact.observer
class InfoMsg extends React.Component<{}, {}> {
    getAfterSlash(s : string) : string {
        if (s.startsWith("^/")) {
            return s.substr(1);
        }
        let slashIdx = s.lastIndexOf("/");
        if (slashIdx == s.length-1) {
            slashIdx = s.lastIndexOf("/", slashIdx-1);
        }
        if (slashIdx == -1) {
            return s;
        }
        return s.substr(slashIdx+1);
    }

    render() {
        let model = GlobalModel;
        let inputModel = model.inputModel;
        let infoMsg = inputModel.infoMsg.get();
        let infoShow = inputModel.infoShow.get();
        let line : string = null;
        let istr : string = null;
        let idx : number = 0;
        let titleStr = null;
        let remoteEditKey = "inforemoteedit";
        if (infoMsg != null) {
            titleStr = infoMsg.infotitle;
            if (infoMsg.remoteedit != null) {
                remoteEditKey += (infoMsg.remoteedit.remoteid == null ? "-new" : "-" + infoMsg.remoteedit.remoteid);
            }
        }
        return (
            <div className="cmd-input-info" style={{display: (infoShow ? "block" : "none")}}>
                <If condition={infoMsg && infoMsg.infotitle != null}>
                    <div key="infotitle" className="info-title">
                        {titleStr}
                    </div>
                </If>
                <If condition={infoMsg && infoMsg.infomsg != null}>
                    <div key="infomsg" className="info-msg">
                        {infoMsg.infomsg}
                    </div>
                </If>
                <If condition={infoMsg && infoMsg.infolines != null}>
                    <div key="infolines" className="info-lines">
                        <For index="idx" each="line" of={infoMsg.infolines}>
                            <div key={idx}>{line == "" ? " " : line}</div>
                        </For>
                    </div>
                </If>
                <If condition={infoMsg && infoMsg.remoteedit}>
                    <InfoRemoteEdit key={"inforemoteedit"} />
                </If>
                <InfoRemoteShow key="inforemoteshow"/>
                <InfoRemoteShowAll key="inforemoteshowall"/>
                <If condition={infoMsg && infoMsg.infocomps != null && infoMsg.infocomps.length > 0}>
                    <div key="infocomps" className="info-comps">
                        <For each="istr" index="idx" of={infoMsg.infocomps}>
                            <div key={idx} className={cn("info-comp", {"metacmd-comp": istr.startsWith("^")})}>
                                {this.getAfterSlash(istr)}
                            </div>
                        </For>
                        <If condition={infoMsg.infocompsmore}>
                            <div key="more" className="info-comp">
                                ...
                            </div>
                        </If>
                    </div>
                </If>
                <If condition={infoMsg && infoMsg.infoerror != null}>
                    <div key="infoerror" className="info-error">
                        [error] {infoMsg.infoerror}
                    </div>
                </If>
            </div>
        );
    }
}

@mobxReact.observer
class HistoryInfo extends React.Component<{}, {}> {
    lastClickHNum : string = null;
    lastClickTs : number = 0;
    containingText : mobx.IObservableValue<string> = mobx.observable.box("");
    
    componentDidMount() {
        let inputModel = GlobalModel.inputModel;
        let hitem = inputModel.getHistorySelectedItem();
        if (hitem == null) {
            hitem = inputModel.getFirstHistoryItem();
        }
        if (hitem != null) {
            inputModel.scrollHistoryItemIntoView(hitem.historynum);
        }
    }

    @boundMethod
    handleItemClick(hitem : HistoryItem) {
        let inputModel = GlobalModel.inputModel;
        let selItem = inputModel.getHistorySelectedItem();
        if (this.lastClickHNum == hitem.historynum && selItem != null && selItem.historynum == hitem.historynum) {
            inputModel.grabSelectedHistoryItem();
            return;
        }
        inputModel.giveFocus();
        inputModel.setHistorySelectionNum(hitem.historynum);
        let now = Date.now();
        this.lastClickHNum = hitem.historynum;
        this.lastClickTs = now;
        setTimeout(() => {
            if (this.lastClickTs == now) {
                this.lastClickHNum = null;
                this.lastClickTs = 0;
            }
        }, 3000);
    }

    renderRemote(hitem : HistoryItem) : any {
        if (hitem.remote == null || isBlank(hitem.remote.remoteid)) {
            return sprintf("%-15s ", "")
        }
        let r = GlobalModel.getRemote(hitem.remote.remoteid);
        if (r == null) {
            return sprintf("%-15s ", "???")
        }
        let rname = "";
        if (!isBlank(r.remotealias)) {
            rname = r.remotealias;
        }
        else {
            rname = r.remotecanonicalname;
        }
        if (!isBlank(hitem.remote.name)) {
            rname = rname + ":" + hitem.remote.name;
        }
        let rtn = sprintf("%-15s ", "[" + rname + "]")
        return rtn;
    }

    renderHItem(hitem : HistoryItem, opts : HistoryQueryOpts, isSelected : boolean) : any {
        let lines = hitem.cmdstr.split("\n");
        let line : string = "";
        let idx = 0;
        let limitRemote = opts.limitRemote;
        let sessionStr = "";
        if (opts.queryType == "global") {
            if (!isBlank(hitem.sessionid)) {
                let s = GlobalModel.getSessionById(hitem.sessionid);
                if (s != null) {
                    sessionStr = s.name.get();
                    if (sessionStr.indexOf(" ") != -1) {
                        sessionStr = "[" + sessionStr + "]";
                    }
                    sessionStr = sprintf("#%-15s ", sessionStr);
                }
            }
        }
        return (
            <div key={hitem.historynum} className={cn("history-item", {"is-selected": isSelected}, {"history-haderror": hitem.haderror}, "hnum-" + hitem.historynum)} onClick={() => this.handleItemClick(hitem)}>
                <div className="history-line">{(isSelected ? "*" : " ")}{sprintf("%5s", hitem.historynum)} {opts.queryType == "global" ? sessionStr : ""}{!limitRemote ? this.renderRemote(hitem) : ""} {lines[0]}</div>
                <For each="line" index="idx" of={lines.slice(1)}>
                    <div key={idx} className="history-line">{line}</div>
                </For>
            </div>
        );
    }

    @boundMethod
    handleClose() {
        GlobalModel.inputModel.toggleInfoMsg();
    }

    render() {
        let inputModel = GlobalModel.inputModel;
        let idx : number = 0;
        let selItem = inputModel.getHistorySelectedItem();
        let hitems = inputModel.getFilteredHistoryItems();
        hitems = hitems.slice().reverse();
        let hitem : HistoryItem = null;
        let opts = inputModel.historyQueryOpts.get();
        return (
            <div className="cmd-history">
                <div className="history-title">
                    <div>history</div>
                    <div className="spacer"></div>
                    <div className="history-opt">[for {opts.queryType} &#x2318;S]</div>
                    <div className="spacer"></div>
                    <div className="history-opt">[containing '{opts.queryStr}']</div>
                    <div className="spacer"></div>
                    <div className="history-opt">[{opts.limitRemote ? "this" : "any"} remote &#x2318;R]</div>
                    <div className="spacer"></div>
                    <div className="history-opt">[{opts.includeMeta ? "" : "no "}metacmds &#x2318;M]</div>
                    <div className="grow-spacer"></div>
                    <div className="history-clickable-opt" onClick={this.handleClose}>(ESC)</div>
                    <div className="spacer"></div>
                </div>
                <div className={cn("history-items", {"show-remotes": !opts.limitRemote}, {"show-sessions": opts.queryType == "global"})}>
                    <If condition={hitems.length == 0}>
                        [no history]
                    </If>
                    <If condition={hitems.length > 0}>
                        <For each="hitem" index="idx" of={hitems}>
                            {this.renderHItem(hitem, opts, (hitem == selItem))}
                        </For>
                    </If>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class CmdInput extends React.Component<{}, {}> {
    @boundMethod
    onInfoToggle() : void {
        GlobalModel.inputModel.toggleInfoMsg();
        return;
    }
    
    render() {
        let model = GlobalModel;
        let inputModel = model.inputModel;
        let win = GlobalModel.getActiveWindow();
        let ri : RemoteInstanceType = null;
        let rptr : RemotePtrType = null;
        if (win != null) {
            ri = win.getCurRemoteInstance();
            rptr = win.curRemote.get();
        }
        let remote : RemoteType = null;
        let remoteState : RemoteStateType = null;
        if (ri != null) {
            remote = GlobalModel.getRemote(ri.remoteid);
            remoteState = ri.state;
        }
        let remoteStr = getRemoteStr(rptr);
        let cwdStr = getCwdStr(remote, remoteState);
        let infoShow = inputModel.infoShow.get();
        let historyShow = !infoShow && inputModel.historyShow.get();
        let infoMsg = inputModel.infoMsg.get();
        let hasInfo = (infoMsg != null);
        let remoteShow = (infoMsg != null && !isBlank(infoMsg.ptyremoteid));
        let focusVal = inputModel.physicalInputFocused.get();
        return (
            <div className={cn("cmd-input has-background-black", {"has-info": infoShow}, {"has-history": historyShow}, {"has-remote": remoteShow})}>
                <div key="focus" className={cn("focus-indicator", {"active": focusVal})}/>
                <div key="minmax" onClick={this.onInfoToggle} className="input-minmax-control">
                    <If condition={infoShow || historyShow}>
                        <i className="fa fa-chevron-down"/>
                    </If>
                    <If condition={!(infoShow || historyShow) && hasInfo}>
                        <i className="fa fa-chevron-up"/>
                    </If>
                </div>
                <If condition={historyShow}>
                    <div className="cmd-input-grow-spacer"></div>
                    <HistoryInfo/>
                </If>
                <InfoMsg key="infomsg"/>
                <div key="prompt" className="cmd-input-context">
                    <div className="has-text-white">
                        <Prompt rptr={rptr} rstate={remoteState}/>
                    </div>
                </div>
                <div key="input" className="cmd-input-field field has-addons">
                    <div className="control cmd-quick-context">
                        <div className="button is-static">{remoteStr}</div>
                    </div>
                    <TextAreaInput/>
                    <div className="control cmd-exec">
                        <div onClick={GlobalModel.inputModel.uiSubmitCommand} className="button">
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

// sw is not null
@mobxReact.observer
class ScreenWindowView extends React.Component<{sw : ScreenWindow}, {}> {
    mutObs : any;
    rszObs : any;
    interObs : IntersectionObserver;
    randomId : string;
    lastHeight : number = null;

    width : mobx.IObservableValue<number> = mobx.observable.box(0);
    setWidth_debounced : (width : number) => void;

    constructor(props : any) {
        super(props);
        this.setWidth_debounced = debounce(1000, this.setWidth.bind(this));
    }

    setWidth(width : number) : void {
        mobx.action(() => {
            this.width.set(width);
            let {sw} = this.props;
            let cols = widthToCols(width);
            if (sw == null || cols == 0) {
                return;
            }
            sw.colsCallback(cols);
        })();
    }

    scrollToBottom(reason : string) {
        let elem = document.getElementById(this.getLinesDOMId());
        if (elem == null) {
            return;
        }
        let oldST = elem.scrollTop;
        elem.scrollTop = elem.scrollHeight;
        // console.log("scroll-elem", oldST, elem.scrollHeight, elem.scrollTop, elem.scrollLeft, elem);
    }
    
    @boundMethod
    scrollHandler(event : any) {
        let {sw} = this.props;
        let target = event.target;
        let atBottom = (target.scrollTop + 30 > (target.scrollHeight - target.offsetHeight));
        if (sw.shouldFollow.get() != atBottom) {
            mobx.action(() => sw.shouldFollow.set(atBottom))();
        }
        // console.log("scroll-handler (sw)>", atBottom, target.scrollTop, target.scrollHeight, event);
    }

    componentDidMount() {
        let elem = document.getElementById(this.getLinesDOMId());
        if (elem != null) {
            this.mutObs = new MutationObserver(this.handleDomMutation.bind(this));
            this.mutObs.observe(elem, {childList: true});
            elem.addEventListener("termresize", this.handleTermResize);
            let {sw} = this.props;
            if (sw.shouldFollow.get()) {
                setTimeout(() => this.scrollToBottom("mount"), 0);
            }
            this.interObs = new IntersectionObserver(interObsCallback, {
                root: elem,
                rootMargin: "800px",
                threshold: 0.0,
            });
        }
        let wvElem = document.getElementById(this.getWindowViewDOMId());
        if (wvElem != null) {
            let width = wvElem.offsetWidth;
            this.setWidth(width);
            this.rszObs = new ResizeObserver(this.handleResize.bind(this));
            this.rszObs.observe(wvElem);
        }
    }

    componentWillUnmount() {
        if (this.mutObs) {
            this.mutObs.disconnect();
        }
        if (this.rszObs) {
            this.rszObs.disconnect();
        }
        if (this.interObs) {
            this.interObs.disconnect();
        }
    }

    handleResize(entries : any) {
        if (entries.length == 0) {
            return;
        }
        let entry = entries[0];
        let width = entry.target.offsetWidth;
        this.setWidth_debounced(width);
        if (this.lastHeight == null) {
            this.lastHeight = entry.target.offsetHeight;
            return;
        }
        if (this.lastHeight != entry.target.offsetHeight) {
            this.lastHeight = entry.target.offsetHeight;
            this.doConditionalScrollToBottom("resize-height");
        }
    }

    handleDomMutation(mutations, mutObs) {
        this.doConditionalScrollToBottom("mut");
    }

    doConditionalScrollToBottom(reason : string) {
        let {sw} = this.props;
        if (sw.shouldFollow.get()) {
            setTimeout(() => this.scrollToBottom(reason), 0);
        }
    }

    getWindow() : Window {
        let {sw} = this.props;
        let win = GlobalModel.getWindowById(sw.sessionId, sw.windowId);
        if (win == null) {
            win = GlobalModel.loadWindow(sw.sessionId, sw.windowId);
        }
        return win;
    }

    getLinesDOMId() {
        return windowLinesDOMId(this.getWindowId());
    }

    @boundMethod
    handleTermResize(e : any) {
        let {sw} = this.props;
        if (sw.shouldFollow.get()) {
            setTimeout(() => this.scrollToBottom("termresize"), 0);
        }
    }

    getWindowViewStyle() : any {
        // return {width: "100%", height: "100%"};
        return {position: "absolute", width: "100%", height: "100%", overflowX: "hidden"};
    }

    getWindowId() : string {
        let {sw} = this.props;
        return sw.windowId;
    }

    getWindowViewDOMId() {
        return sprintf("window-view-%s", this.getWindowId());
    }

    renderError(message : string) {
        let {sw} = this.props;
        return (
            <div className="window-view" style={this.getWindowViewStyle()} id={this.getWindowViewDOMId()} data-windowid={sw.windowId}>
                <div key="window-tag" className="window-tag">
                    <span>{sw.name.get()}{sw.shouldFollow.get() ? "*" : ""}</span>
                </div>
                <div key="lines" className="lines" id={this.getLinesDOMId()}></div>
                <div key="window-empty" className="window-empty">
                    <div>{message}</div>
                </div>
            </div>
        );
    }
    
    render() {
        let {sw} = this.props;
        let win = this.getWindow();
        if (win == null || !win.loaded.get()) {
            return this.renderError("(loading)");
        }
        if (win.loadError.get() != null) {
            return this.renderError(sprintf("(%s)", win.loadError.get()));
        }
        if (this.width.get() == 0) {
            return this.renderError("");
        }
        let idx = 0;
        let line : LineType = null;
        let screen = GlobalModel.getScreenById(sw.sessionId, sw.screenId);
        let session = GlobalModel.getSessionById(sw.sessionId);
        let linesStyle : any = {};
        if (win.lines.length == 0) {
            linesStyle.display = "none";
        }
        let isActive = sw.isActive();
        return (
            <div className="window-view" style={this.getWindowViewStyle()} id={this.getWindowViewDOMId()}>
                <div key="window-tag" className={cn("window-tag", {"is-active": isActive})}>
                    <span>
                        {sw.name.get()}
                        <If condition={sw.shouldFollow.get()}>
                            &nbsp;<i className="fa fa-caret-down"/>
                        </If>
                    </span>
                </div>
                <div key="lines" className="lines" onScroll={this.scrollHandler} id={this.getLinesDOMId()} style={linesStyle}>
                    <div className="lines-spacer"></div>
                    <For each="line" of={win.lines} index="idx">
                        <Line key={line.lineid} line={line} sw={sw} width={this.width.get()} interObs={this.interObs} initVis={idx > win.lines.length-1-7}/>
                    </For>
                </div>
                <If condition={win.lines.length == 0}>
                    <div key="window-empty" className="window-empty">
                        <div><code>[session="{session.name.get()}" screen="{screen.name.get()}" window="{sw.name.get()}"]</code></div>
                    </div>
                </If>
            </div>
        );
    }
}

@mobxReact.observer
class ScreenView extends React.Component<{screen : Screen}, {}> {
    render() {
        let {screen} = this.props;
        let sw : ScreenWindow = null;
        if (screen != null) {
            sw = screen.getActiveSW();
        }
        if (screen == null || sw == null) {
            return (
                <div className="screen-view">
                    (no screen or window)
                </div>
            );
        }
        return (
            <div className="screen-view" data-screenid={sw.screenId}>
                <ScreenWindowView key={sw.windowId} sw={sw}/>
            </div>
        );
    }
}

@mobxReact.observer
class ScreenTabs extends React.Component<{session : Session}, {}> {
    @boundMethod
    handleNewScreen() {
        let {session} = this.props;
        GlobalCommandRunner.createNewScreen();
    }

    @boundMethod
    handleSwitchScreen(screenId : string) {
        let {session} = this.props;
        if (session == null) {
            return;
        }
        if (session.activeScreenId.get() == screenId) {
            return;
        }
        let screen = session.getScreenById(screenId);
        if (screen == null) {
            return;
        }
        GlobalCommandRunner.switchScreen(screenId);
    }

    handleContextMenu(e : any, screenId : string) : void {
        e.preventDefault();
        console.log("handle context menu!", screenId);
        let model = GlobalModel;
        model.contextScreen(e, screenId);
    }

    render() {
        let {session} = this.props;
        if (session == null) {
            return null;
        }
        let screen : Screen = null;
        let index = 0;
        return (
            <div className="screen-tabs">
                <For each="screen" index="index" of={session.screens}>
                    <div key={screen.screenId} className={cn("screen-tab", {"is-active": session.activeScreenId.get() == screen.screenId}, "color-" + screen.getTabColor())} onClick={() => this.handleSwitchScreen(screen.screenId)} onContextMenu={(event) => this.handleContextMenu(event, screen.screenId)}>
                        {screen.name.get()}
                        <If condition={index+1 <= 9}>
                            <div className="tab-index">&#x2318;{index+1}</div>
                        </If>
                    </div>
                </For>
                <div key="new-screen" className="screen-tab new-screen" onClick={this.handleNewScreen}>
                    +
                </div>
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
            <div className="session-view" data-sessionid={session.sessionId}>
                <ScreenView screen={activeScreen}/>
                <ScreenTabs session={session}/>
                <CmdInput/>
            </div>
        );
    }
}

function getConnVal(r : RemoteType) : number {
    if (r.status == "connected") {
        return 1;
    }
    if (r.status == "init" || r.status == "disconnected") {
        return 2;
    }
    if (r.status == "error") {
        return 3;
    }
    return 4;
}

@mobxReact.observer
class RemoteStatusLight extends React.Component<{remote : RemoteType}, {}> {
    render() {
        let remote = this.props.remote;
        let status = "error";
        let wfp = false;
        if (remote != null) {
            status = remote.status;
            wfp = remote.waitingforpassword;
        }
        let icon = "fa-circle"
        if (status == "connecting") {
            icon = (wfp ? "fa-key" : "fa-refresh");
        }
        return (
            <i className={cn("remote-status fa", icon, "status-" + status)}/>
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
        GlobalCommandRunner.switchSession(sessionId);
    }

    handleNewSession() {
        GlobalCommandRunner.createNewSession();
    }

    clickRemotes() {
        GlobalCommandRunner.showAllRemotes();
    }

    remoteDisplayName(remote : RemoteType) : any {
        if (!isBlank(remote.remotealias)) {
            return (
                <>
                    <span>{remote.remotealias}</span>
                    <span className="small-text"> {remote.remotecanonicalname}</span>
                </>
            );
        }
        return (<span>{remote.remotecanonicalname}</span>);
    }

    clickRemote(remote : RemoteType) {
        GlobalCommandRunner.showRemote(remote.remoteid);
    }

    @boundMethod
    handleAddRemote() : void {
        GlobalCommandRunner.openCreateRemote();
    }

    render() {
        let model = GlobalModel;
        let activeSessionId = model.activeSessionId.get();
        let activeWindow = model.getActiveWindow();
        let activeRemoteId : string = null;
        if (activeWindow != null) {
            let rptr = activeWindow.curRemote.get();
            if (rptr != null && !isBlank(rptr.remoteid)) {
                activeRemoteId = rptr.remoteid;
            }
        }
        let session : Session = null;
        let remotes = model.remotes ?? [];
        let remote : RemoteType = null;
        let idx : number = 0;
        remotes = sortAndFilterRemotes(remotes);
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
                            <For each="session" index="idx" of={model.sessionList}>
                                <li key={session.sessionId}><a className={cn({"is-active": activeSessionId == session.sessionId})} onClick={() => this.handleSessionClick(session.sessionId)}>
                                    <span className="session-num">{idx+1}&nbsp;</span>
                                    {session.name.get()}
                                </a></li>
                            </For>
                            <li className="new-session"><a onClick={() => this.handleNewSession()}><i className="fa fa-plus"/> New Session</a></li>
                        </If>
                    </ul>
                    <p className="menu-label">
                        Shared Sessions
                    </p>
                    <ul className="menu-list">
                        <li><a>server-status</a></li>
                        <li><a className="activity">bug-3458 <div className="tag is-link">3</div></a></li>
                        <li><a>dev-build</a></li>
                        <li className="new-session"><a><i className="fa fa-plus"/> New Session</a></li>
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
                        <a onClick={() => this.clickRemotes()}>Remotes</a>
                    </p>
                    <ul className="menu-list remotes-menu-list">
                        <For each="remote" of={remotes}>
                            <li key={remote.remoteid} className={cn("remote-menu-item")}><a className={cn({"is-active": (remote.remoteid == activeRemoteId)})} onClick={() => this.clickRemote(remote)}>
                                <RemoteStatusLight remote={remote}/>
                                {this.remoteDisplayName(remote)}
                            </a></li>
                        </For>
                        <li key="add-remote" className="add-remote">
                            <a onClick={() => this.handleAddRemote()}><i className="fa fa-plus"/> Add Remote</a>
                        </li>
                    </ul>
                    <div className="bottom-spacer"></div>
                </div>
            </div>
        );
    }
}

function sortAndFilterRemotes(origRemotes : RemoteType[]) : RemoteType[] {
    let remotes = origRemotes.filter((r) => !r.archived);
    remotes.sort((a, b) => {
        let connValA = getConnVal(a);
        let connValB = getConnVal(b);
        if (connValA != connValB) {
            return connValA - connValB;
        }
        return a.remoteidx - b.remoteidx;
    });
    return remotes;
}

@mobxReact.observer
class AddRemoteModal extends React.Component<{}, {}> {
    @boundMethod
    handleModalClose() : void {
        mobx.action(() => {
            GlobalModel.addRemoteModalOpen.set(false);
        })();
    }
    
    render() {
        return (
            <div className="sc-modal add-remote-modal modal is-active">
                <div onClick={this.handleModalClose} className="modal-background"></div>
                <div className="modal-content message">
                    <div className="message-header">
                        <p>Add Remote</p>
                    </div>
                    <div className="message-content">
                        hello
                    </div>
                    <div className="message-footer">
                        <button onClick={this.handleModalClose} className="button">Cancel</button>
                        <div className="spacer"></div>
                        <button className="button is-primary">
                            <span className="icon">
                                <i className="fa fa-plus"/>
                            </span>
                            <span>Add Remote</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class RemoteModal extends React.Component<{}, {}> {
    @boundMethod
    handleModalClose() : void {
        mobx.action(() => {
            GlobalModel.remotesModalOpen.set(false);
        })();
    }

    @boundMethod
    handleAddRemote() : void {
        mobx.action(() => {
            GlobalModel.addRemoteModalOpen.set(true);
        })();
    }
    
    render() {
        let model = GlobalModel;
        let remotes = sortAndFilterRemotes(model.remotes);
        let remote : RemoteType = null;
        return (
            <div className="sc-modal remote-modal modal is-active">
                <div onClick={this.handleModalClose} className="modal-background"></div>
                <div className="modal-content message">
                    <div className="message-header">
                        <p>Remotes</p>
                    </div>
                    <div className="message-content">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th className="status-header">Status</th>
                                    <th>Alias</th>
                                    <th>User@Host</th>
                                    <th>Connect</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each="remote" of={remotes}>
                                    <tr key={remote.remoteid}>
                                        <td className="status-cell">
                                            <div><RemoteStatusLight remote={remote}/></div>
                                        </td>
                                        <td>
                                            {remote.remotealias}
                                            <If condition={isBlank(remote.remotealias)}>
                                                -
                                            </If>
                                        </td>
                                        <td>
                                            {remote.remotecanonicalname}
                                        </td>
                                        <td>
                                            {remote.connectmode}
                                        </td>
                                    </tr>
                                </For>
                            </tbody>
                        </table>
                    </div>
                    <div className="message-footer">
                        <button onClick={this.handleAddRemote} className="button is-primary">
                            <span className="icon">
                                <i className="fa fa-plus"/>
                            </span>
                            <span>Add Remote</span>
                        </button>
                        <div className="spacer"></div>
                        <button onClick={this.handleModalClose} className="button">Close</button>
                    </div>
                </div>
                <button onClick={this.handleModalClose} className="modal-close is-large" aria-label="close"></button>
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
                <If condition={GlobalModel.addRemoteModalOpen.get()}>
                    <AddRemoteModal/>
                </If>
                <If condition={GlobalModel.remotesModalOpen.get() && !GlobalModel.addRemoteModalOpen.get()}>
                    <RemoteModal/>
                </If>
            </div>
        );
    }
}


export {Main};

