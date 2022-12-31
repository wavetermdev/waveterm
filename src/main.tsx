import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {debounce, throttle} from "throttle-debounce";
import {v4 as uuidv4} from "uuid";
import dayjs from "dayjs";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames";
import {TermWrap} from "./term";
import type {SessionDataType, LineType, CmdDataType, RemoteType, RemoteStateType, RemoteInstanceType, RemotePtrType, HistoryItem, HistoryQueryOpts, RemoteEditType, FeStateType} from "./types";
import localizedFormat from 'dayjs/plugin/localizedFormat';
import {GlobalModel, GlobalCommandRunner, Session, Cmd, Window, Screen, ScreenWindow, riToRPtr, widthToCols, termWidthFromCols, termHeightFromRows, termRowsFromHeight} from "./model";
import {isModKeyPress} from "./util";

dayjs.extend(localizedFormat)

const RemotePtyRows = 8;
const RemotePtyCols = 80;
const PasswordUnchangedSentinel = "--unchanged--";
const LinesVisiblePadding = 500;

const RemoteColors = ["red", "green", "yellow", "blue", "magenta", "cyan", "white", "orange"];

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K,V> = mobx.ObservableMap<K,V>;

type HeightChangeCallbackType = (lineNum : number, newHeight : number, oldHeight : number) => void;

type InterObsValue = {
    sessionid : string,
    windowid : string,
    lineid : string,
    cmdid : string,
    visible : mobx.IObservableValue<boolean>,
    timeoutid? : any,
};

function isBlank(s : string) : boolean {
    return (s == null || s == "");
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

function getCwdStr(remote : RemoteType, state : FeStateType) : string {
    if ((state == null || state.cwd == null) && remote != null) {
        return "~";
    }
    let cwd = "(unknown)";
    if (state && state.cwd) {
        cwd = state.cwd;
    }
    if (remote && remote.remotevars.home) {
        cwd = replaceHomePath(cwd, remote.remotevars.cwd)
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
class LineAvatar extends React.Component<{line : LineType, cmd : Cmd}, {}> {
    render() {
        let {line, cmd} = this.props;
        let lineNumStr = (line.linenumtemp ? "~" : "") + String(line.linenum);
        let status = (cmd != null ? cmd.getStatus() : "done");
        let rtnstate = (cmd != null ? cmd.getRtnState() : false);
        return (
            <div className={cn("avatar", "num-"+lineNumStr.length, "status-" + status, {"ephemeral": line.ephemeral}, {"rtnstate": rtnstate})}>
                {lineNumStr}
                <If condition={status == "hangup" || status == "error"}>
                    <i className="fa fa-exclamation-triangle status-icon"/>
                </If>
                <If condition={status == "detached"}>
                    <i className="fa fa-refresh status-icon"/>
                </If>
            </div>
        );
    }
}

@mobxReact.observer
class LineText extends React.Component<{sw : ScreenWindow, line : LineType}, {}> {
    @boundMethod
    clickHandler() {
        let {line} = this.props;
        GlobalCommandRunner.swSelectLine(String(line.linenum));
    }

    render() {
        let {sw, line} = this.props;
        let formattedTime = getLineDateStr(line.ts);
        let isSelected = (sw.selectedLine.get() == line.linenum);
        let isFocused = (sw.focusType.get() == "cmd");
        return (
            <div className="line line-text" data-lineid={line.lineid} data-linenum={line.linenum} data-windowid={line.windowid} onClick={this.clickHandler}>
                <div className={cn("focus-indicator", {"selected": isSelected}, {"active": isSelected && isFocused})}/>
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
class Prompt extends React.Component<{rptr : RemotePtrType, festate : FeStateType}, {}> {
    render() {
        let rptr = this.props.rptr;
        if (rptr == null || isBlank(rptr.remoteid)) {
            return <span className={cn("term-prompt", "color-green")}>&nbsp;</span>
        }
        let remote = GlobalModel.getRemote(this.props.rptr.remoteid);
        let remoteStr = getRemoteStr(rptr);
        let cwd = getCwdStr(remote, this.props.festate);
        let isRoot = false;
        if (remote && remote.remotevars) {
            if (remote.remotevars["sudo"] || remote.remotevars["bestuser"] == "root") {
                isRoot = true;
            }
        }
        let colorClass = (isRoot ? "color-red" : "color-green");
        if (remote && remote.remoteopts && remote.remoteopts.color) {
            colorClass = "color-" + remote.remoteopts.color;
        }
        return (
            <span className={cn("term-prompt", colorClass)}>[{remoteStr}] {cwd} {isRoot ? "#" : "$"}</span>
        );
    }
}

@mobxReact.observer
class LineCmd extends React.Component<{sw : ScreenWindow, line : LineType, width : number, staticRender : boolean, visible : OV<boolean>, onHeightChange : HeightChangeCallbackType}, {}> {
    termLoaded : mobx.IObservableValue<boolean> = mobx.observable.box(false, {name: "linecmd-term-loaded"});
    lineRef : React.RefObject<any> = React.createRef();
    rtnStateDiff : mobx.IObservableValue<string> = mobx.observable.box(null, {name: "linecmd-rtn-state-diff"});
    rtnStateDiffFetched : boolean = false;
    
    constructor(props) {
        super(props);
    }

    checkLoad() : void {
        let {line, staticRender, visible} = this.props;
        if (staticRender) {
            return;
        }
        let vis = visible && visible.get();
        let curVis = this.termLoaded.get();
        if (vis && !curVis) {
            this.loadTerminal();
        }
        else if (!vis && curVis) {
            this.unloadTerminal(false);
        }
    }

    checkStateDiffLoad() : void {
        let {line, staticRender, visible} = this.props;
        if (staticRender) {
            return;
        }
        if (!visible) {
            if (this.rtnStateDiffFetched) {
                this.rtnStateDiffFetched = false;
                this.setRtnStateDiff(null);
            }
            return;
        }
        let cmd = GlobalModel.getCmd(line);
        if (cmd == null || !cmd.getRtnState() || this.rtnStateDiffFetched) {
            return;
        }
        if (cmd.getStatus() != "done") {
            return;
        }
        this.fetchRtnStateDiff();
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
        sw.connectElem(termElem, line, cmd, this.props.width);
        mobx.action(() => this.termLoaded.set(true))();
    }

    unloadTerminal(unmount : boolean) : void {
        let {sw, line} = this.props;
        sw.disconnectElem(line.cmdid);
        if (!unmount) {
            mobx.action(() => this.termLoaded.set(false))();
            let termId = "term-" + getLineId(line);
            let termElem = document.getElementById(termId);
            if (termElem != null) {
                termElem.replaceChildren();
            }
        }
    }

    fetchRtnStateDiff() : void {
        if (this.rtnStateDiffFetched) {
            return;
        }
        let {line} = this.props;
        this.rtnStateDiffFetched = true;
        let usp = new URLSearchParams({sessionid: line.sessionid, cmdid: line.cmdid});
        let url = GlobalModel.getBaseHostPort() + "/api/rtnstate?" + usp.toString();
        let fetchHeaders = GlobalModel.getFetchHeaders();
        fetch(url, {headers: fetchHeaders}).then((resp) => {
            if (!resp.ok) {
                throw new Error(sprintf("Bad fetch response for /api/rtnstate: %d %s", resp.status, resp.statusText));
            }
            return resp.text();
        }).then((text) => {
            this.setRtnStateDiff(text ?? "");
        }).catch((err) => {
            this.setRtnStateDiff("ERROR " + err.toString())
        });
    }

    setRtnStateDiff(val : string) : void {
        mobx.action(() => {
            this.rtnStateDiff.set(val);
        })();
    }

    componentDidMount() {
        this.componentDidUpdate(null, null, null);
    }

    componentWillUnmount() {
        if (this.termLoaded.get()) {
            this.unloadTerminal(true);
        }
    }

    // FIXME
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
        let cwd = getCwdStr(remote, cmd.getRemoteFeState());
        return (
            <div className="metapart-mono cmdtext">
                <Prompt rptr={cmd.remote} festate={cmd.getRemoteFeState()}/> {cmd.getSingleLineCmdText()}
            </div>
        );
    }

    @boundMethod
    clickTermBlock(e : any) {
        let {sw, line} = this.props;
        let model = GlobalModel;
        let termWrap = sw.getTermWrap(line.cmdid);
        if (termWrap != null) {
            termWrap.focusTerminal();
        }
    }

    getSnapshotBeforeUpdate(prevProps, prevState) : {height : number} {
        let elem = this.lineRef.current;
        if (elem == null) {
            return {height: 0};
        }
        return {height: elem.offsetHeight};
    }

    componentDidUpdate(prevProps, prevState, snapshot : {height : number}) : void {
        let {line} = this.props;
        let curHeight = 0;
        let elem = this.lineRef.current;
        if (elem != null) {
            curHeight = elem.offsetHeight;
        }
        if (snapshot == null) {
            snapshot = {height: 0};
        }
        if (snapshot.height != curHeight && this.props.onHeightChange != null) {
            this.props.onHeightChange(line.linenum, curHeight, snapshot.height);
        }
        this.checkLoad();
        this.checkStateDiffLoad();
    }

    @boundMethod
    handleClick() {
        let {line} = this.props;
        GlobalCommandRunner.swSelectLine(String(line.linenum), "cmd");
    }

    @boundMethod
    clickStar() {
        let {line} = this.props;
        if (!line.star || line.star == 0) {
            GlobalCommandRunner.lineStar(line.lineid, 1);
        }
        else {
            GlobalCommandRunner.lineStar(line.lineid, 0);
        }
    }
    
    render() {
        let {sw, line, width, staticRender, visible} = this.props;
        let model = GlobalModel;
        let lineid = line.lineid;
        let isVisible = visible.get();
        let formattedTime = getLineDateStr(line.ts);
        let cmd = model.getCmd(line);
        if (cmd == null) {
            return (
                <div className="line line-invalid" id={"line-" + getLineId(line)} ref={this.lineRef} data-lineid={line.lineid} data-linenum={line.linenum} data-windowid={line.windowid}>
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
        let lineNumStr = (line.linenumtemp ? "~" : "") + String(line.linenum);
        let isSelected = (sw.selectedLine.get() == line.linenum);
        let isPhysicalFocused = sw.getIsFocused(line.linenum);
        let swFocusType = sw.focusType.get();
        let isFocused = isPhysicalFocused && (swFocusType == "cmd" || swFocusType == "cmd-fg");
        let isFgFocused = isPhysicalFocused && swFocusType == "cmd-fg";
        let isStatic = staticRender;
        let rsdiff = this.rtnStateDiff.get();
        // console.log("render", "#" + line.linenum, termHeight, usedRows, cmd.getStatus(), (this.rtnStateDiff.get() != null), (!cmd.isRunning() ? "cmd-done" : "running"));
        let mainDivCn = cn(
            "line",
            "line-cmd",
            {"focus": isFocused},
            {"cmd-done": !cmd.isRunning()},
            {"has-rtnstate": cmd.getRtnState()},
        );
        return (
            <div className={mainDivCn} id={"line-" + getLineId(line)}
                 ref={this.lineRef} onClick={this.handleClick}
                 data-lineid={line.lineid} data-linenum={line.linenum} data-windowid={line.windowid} data-cmdid={line.cmdid}>
                <div className={cn("focus-indicator", {"selected": isSelected}, {"active": isSelected && isFocused}, {"fg-focus": isFgFocused})}/>
                <div className="line-header">
                    <LineAvatar line={line} cmd={cmd}/>
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
                    <div className="flex-spacer"/>
                    <div className={cn("line-star", {"active": line.star > 0})} onClick={this.clickStar}>
                        <If condition={!line.star || line.star == 0}>
                            <i className="fa fa-star-o"/>
                        </If>
                        <If condition={line.star > 0}>
                            <i className="fa fa-star"/>
                        </If>
                    </div>
                </div>
                <div className={cn("terminal-wrapper", {"focus": isFocused}, {"cmd-done": !cmd.isRunning()}, {"zero-height": (termHeight == 0)})}>
                    <If condition={!isFocused}>
                        <div className="term-block" onClick={this.clickTermBlock}></div>
                    </If>
                    <div className="terminal-connectelem" id={"term-" + getLineId(line)} data-cmdid={line.cmdid} style={{height: termHeight}}></div>
                    <If condition={!termLoaded}><div className="terminal-loading-message">(loading)</div></If>
                </div>
                <If condition={cmd.getRtnState()}>
                    <div className="cmd-rtnstate" style={{visibility: ((cmd.getStatus() == "done") ? "visible" : "hidden")}}>
                        <If condition={rsdiff == null || rsdiff == ""}>
                            <div className="cmd-rtnstate-label">state unchanged</div>
                            <div className="cmd-rtnstate-sep"></div>
                        </If>
                        <If condition={rsdiff != null && rsdiff != ""}>
                            <div className="cmd-rtnstate-label">new state</div>
                            <div className="cmd-rtnstate-sep"></div>
                            <div className="cmd-rtnstate-diff">{this.rtnStateDiff.get()}</div>
                        </If>
                    </div>
                </If>
            </div>
        );
    }
}

@mobxReact.observer
class Line extends React.Component<{sw : ScreenWindow, line : LineType, width : number, staticRender : boolean, visible : OV<boolean>, onHeightChange : HeightChangeCallbackType}, {}> {
    render() {
        let line = this.props.line;
        if (line.archived) {
            return null;
        }
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
    lastFocusType : string = null;
    mainInputRef : React.RefObject<any>;
    historyInputRef : React.RefObject<any>;

    constructor(props) {
        super(props);
        this.mainInputRef = React.createRef();
        this.historyInputRef = React.createRef();
    }

    setFocus() : void {
        let inputModel = GlobalModel.inputModel;
        if (inputModel.historyShow.get()) {
            this.historyInputRef.current.focus();
        }
        else {
            this.mainInputRef.current.focus();
        }
    }

    componentDidMount() {
        let activeSW = GlobalModel.getActiveSW();
        if (activeSW != null) {
            let focusType = activeSW.focusType.get();
            if (focusType == "input") {
                this.setFocus();
            }
            this.lastFocusType = focusType;
        }
    }

    componentDidUpdate() {
        let activeSW = GlobalModel.getActiveSW();
        if (activeSW != null) {
            let focusType = activeSW.focusType.get();
            if (this.lastFocusType != focusType && focusType == "input") {
                this.setFocus();
            }
            this.lastFocusType = focusType;
        }
        let inputModel = GlobalModel.inputModel;
        if (inputModel.forceCursorPos.get() != null) {
            if (this.mainInputRef.current != null) {
                this.mainInputRef.current.selectionStart = inputModel.forceCursorPos.get();
                this.mainInputRef.current.selectionEnd = inputModel.forceCursorPos.get();
            }
            mobx.action(() => inputModel.forceCursorPos.set(null))();
        }
    }

    getLinePos(elem : any) : {numLines : number, linePos : number} {
        let numLines = elem.value.split("\n").length;
        let linePos = elem.value.substr(0, elem.selectionStart).split("\n").length;
        return {numLines, linePos};
    }

    @mobx.action @boundMethod
    onKeyDown(e : any) {
        mobx.action(() => {
            if (isModKeyPress(e)) {
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
                    GlobalModel.submitCommand("_compgen", null, [curLine], {"comppos": String(curLine.length), "compshow": "1", "nohist": "1"}, true);
                    return;
                }
                else {
                    GlobalModel.submitCommand("_compgen", null, [curLine], {"comppos": String(curLine.length), "nohist": "1"}, true);
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
                e.stopPropagation();
                let inputModel = GlobalModel.inputModel;
                inputModel.toggleInfoMsg();
                if (inputModel.inputMode.get() != null) {
                    inputModel.resetInputMode();
                }
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
        if (e.code == "KeyG" && e.getModifierState("Control")) {
            e.preventDefault();
            inputModel.resetInput();
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
            if (this.historyInputRef.current != null) {
                this.historyInputRef.current.focus();
            }
            return;
        }
        inputModel.setPhysicalInputFocused(true);
    }

    @boundMethod
    handleMainBlur(e : any) {
        if (document.activeElement == this.mainInputRef.current) {
            return;
        }
        GlobalModel.inputModel.setPhysicalInputFocused(false);
    }

    @boundMethod
    handleHistoryFocus(e : any) {
        let inputModel = GlobalModel.inputModel;
        if (!inputModel.historyShow.get()) {
            e.preventDefault();
            if (this.mainInputRef.current != null) {
                this.mainInputRef.current.focus();
            }
            return;
        }
        inputModel.setPhysicalInputFocused(true);
    }

    @boundMethod
    handleHistoryBlur(e : any) {
        if (document.activeElement == this.historyInputRef.current) {
            return;
        }
        GlobalModel.inputModel.setPhysicalInputFocused(false);
    }

    render() {
        let model = GlobalModel;
        let inputModel = model.inputModel;
        let curLine = inputModel.getCurLine();
        let fcp = inputModel.forceCursorPos.get(); // for reaction
        let numLines = curLine.split("\n").length;
        let displayLines = numLines;
        if (displayLines > 5) {
            displayLines = 5;
        }
        let disabled = inputModel.historyShow.get();
        if (disabled) {
            displayLines = 1;
        }
        let activeSW = GlobalModel.getActiveSW();
        if (activeSW != null) {
            activeSW.focusType.get(); // for reaction
        }
        return (
            <div className="control cmd-input-control is-expanded">
                <textarea ref={this.mainInputRef} spellCheck="false" id="main-cmd-input" onFocus={this.handleMainFocus} onBlur={this.handleMainBlur} rows={displayLines} value={curLine} onKeyDown={this.onKeyDown} onChange={this.onChange} className={cn("textarea", {"display-disabled": disabled})}></textarea>
                <input ref={this.historyInputRef} spellCheck="false" className="history-input" type="text" onFocus={this.handleHistoryFocus} onKeyDown={this.onHistoryKeyDown} onChange={this.handleHistoryInput} value={inputModel.historyQueryOpts.get().queryStr}/>
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
            inputModel.remoteTermWrap.focusTerminal();
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
        let isTermFocused = (inputModel.remoteTermWrap == null ? false : inputModel.remoteTermWrapFocus.get());
        let remote : RemoteType;
        if (ptyRemoteId != null) {
            remote = GlobalModel.getRemote(ptyRemoteId);
        }
        if (ptyRemoteId == null || remote == null) {
            return (
                <>
                    <div key="term" className="terminal-wrapper" style={{display: "none"}}>
                        <div key="terminal" className="terminal-connectelem" id="term-remote"></div>
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
                <div key="term" className={cn("terminal-wrapper", {"focus": isTermFocused}, (remote != null ? "status-" + remote.status : null))} style={{display: (ptyRemoteId == null ? "none" : "block"), width: termWidthFromCols(RemotePtyCols)}}>
                    <If condition={!isTermFocused}>
                        <div key="termblock" className="term-block" onClick={this.clickTermBlock}></div>
                    </If>
                    <If condition={inputModel.showNoInputMsg.get()}>
                        <div key="termtag" className="term-tag">input is only allowed while status is 'connecting'</div>
                    </If>
                    <div key="terminal" className="terminal-connectelem" id="term-remote" data-remoteid={ptyRemoteId} style={{height: termHeightFromRows(RemotePtyRows)}}></div>
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
                        add new remote <If condition={this.hostName.get() != ""}>'{this.remoteCName()}'</If>
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
                <div key="color" className="remote-input-field" style={{display: "none"}}>
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
                    <If condition={isEditMode}>
                        <a tabIndex={0} style={{marginLeft: 20, marginRight: 5}} onClick={this.doArchiveRemote} onKeyDown={this.keyDownCreateRemote} className={cn("text-button", (this.archiveConfirm.get() ? "error-button" : "disabled-button"))}>[archive remote]</a>
                        <input onChange={this.updateArchiveConfirm} checked={this.archiveConfirm.get()} style={{marginRight: 20}} type="checkbox"/>
                        {"|"}
                    </If>
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
    cmdInputRef : React.RefObject<any> = React.createRef();
    
    @boundMethod
    onInfoToggle() : void {
        GlobalModel.inputModel.toggleInfoMsg();
        return;
    }

    componentDidMount() {
        let elem = this.cmdInputRef.current;
        if (elem == null) {
            return;
        }
        let height = elem.offsetHeight;
        mobx.action(() => {
            GlobalModel.inputModel.cmdInputHeight.set(height);
        })();
    }

    componentDidUpdate(prevProps, prevState, snapshot : {height : number}) : void {
        let elem = this.cmdInputRef.current;
        if (elem == null) {
            return;
        }
        let height = elem.offsetHeight;
        mobx.action(() => {
            GlobalModel.inputModel.cmdInputHeight.set(height);
        })();
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
        let remoteState : FeStateType = null;
        if (ri != null) {
            remote = GlobalModel.getRemote(ri.remoteid);
            remoteState = ri.festate;
        }
        let remoteStr = getRemoteStr(rptr);
        let cwdStr = getCwdStr(remote, remoteState);
        let infoShow = inputModel.infoShow.get();
        let historyShow = !infoShow && inputModel.historyShow.get();
        let infoMsg = inputModel.infoMsg.get();
        let hasInfo = (infoMsg != null);
        let remoteShow = (infoMsg != null && !isBlank(infoMsg.ptyremoteid));
        let focusVal = inputModel.physicalInputFocused.get();
        let inputMode : string = inputModel.inputMode.get();
        return (
            <div ref={this.cmdInputRef} className={cn("cmd-input has-background-black", {"has-info": infoShow}, {"has-history": historyShow}, {"has-remote": remoteShow})}>
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
                        <Prompt rptr={rptr} festate={remoteState}/>
                    </div>
                </div>
                <div key="input" className={cn("cmd-input-field field has-addons", (inputMode != null ? "inputmode-" + inputMode : null))}>
                    <If condition={inputMode != null}>
                        <div className="control cmd-quick-context">
                            <div className="button is-static">{inputMode}</div>
                        </div>
                    </If>
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

@mobxReact.observer
class LinesView extends React.Component<{sw : ScreenWindow, width : number, lines : LineType[]}, {}> {
    rszObs : any;
    linesRef : React.RefObject<any>;
    staticRender : OV<boolean> = mobx.observable.box(true, {name: "static-render"});
    lastOffsetHeight : number = 0;
    lastOffsetWidth : number = 0;
    ignoreNextScroll : boolean = false;
    visibleMap : Map<string, OV<boolean>>;  // lineid => OV<vis>
    lastSelectedLine : number = 0;
    lastLinesLength : number = 0;

    computeAnchorLine_throttled : () => void;
    computeVisibleMap_debounced : () => void;

    constructor(props) {
        super(props);
        this.linesRef = React.createRef();
        this.computeAnchorLine_throttled = throttle(100, this.computeAnchorLine.bind(this), {noLeading: true, noTrailing: false});
        this.visibleMap = new Map();
        this.computeVisibleMap_debounced = debounce(1000, this.computeVisibleMap.bind(this));
    }
    
    @boundMethod
    scrollHandler() {
        // console.log("scroll", this.linesRef.current.scrollTop);
        this.computeVisibleMap_debounced(); // always do this
        if (this.ignoreNextScroll) {
            this.ignoreNextScroll = false;
            return;
        }
        this.computeAnchorLine_throttled(); // only do this when we're not ignoring the scroll
    }

    computeAnchorLine() : void {
        let {sw} = this.props;
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            sw.setAnchorFields(null, 0, "no-lines");
            return;
        }
        let lineElemArr = linesElem.querySelectorAll(".line");
        if (lineElemArr == null) {
            sw.setAnchorFields(null, 0, "no-line");
            return;
        }
        let scrollTop = linesElem.scrollTop;
        let height = linesElem.clientHeight;
        let containerBottom = scrollTop + height;
        let anchorElem : HTMLElement = null;
        for (let i=lineElemArr.length-1; i >= 0; i--) {
            let lineElem = lineElemArr[i];
            let bottomPos = lineElem.offsetTop + lineElem.offsetHeight;
            if (anchorElem == null && (bottomPos <= containerBottom || lineElem.offsetTop <= scrollTop)) {
                anchorElem = lineElem;
            }
        }
        if (anchorElem == null) {
            anchorElem = lineElemArr[0];
        }
        sw.setAnchorFields(parseInt(anchorElem.dataset.linenum), containerBottom - (anchorElem.offsetTop + anchorElem.offsetHeight), "computeAnchorLine");
    }

    computeVisibleMap() : void {
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            return;
        }
        let lineElemArr = linesElem.querySelectorAll(".line");
        if (lineElemArr == null) {
            return;
        }
        let containerTop = linesElem.scrollTop - LinesVisiblePadding;
        let containerBot = linesElem.scrollTop + linesElem.clientHeight + LinesVisiblePadding;
        let newMap = new Map<string, boolean>();
        for (let i=0; i<lineElemArr.length; i++) {
            let lineElem = lineElemArr[i];
            let lineTop = lineElem.offsetTop;
            let lineBot = lineElem.offsetTop + lineElem.offsetHeight;
            let maxTop = Math.max(containerTop, lineTop);
            let minBot = Math.min(containerBot, lineBot);
            newMap.set(lineElem.dataset.linenum, (maxTop < minBot));
        }
        mobx.action(() => {
            for (let [k, v] of newMap) {
                let oldVal = this.visibleMap.get(k);
                if (oldVal == null) {
                    oldVal = mobx.observable.box(v, {name: "lines-vis-map"});
                    this.visibleMap.set(k, oldVal);
                }
                if (oldVal.get() != v) {
                    oldVal.set(v);
                }
            }
            for (let [k, v] of this.visibleMap) {
                if (!newMap.has(k)) {
                    this.visibleMap.delete(k);
                }
            }
        })();
    }

    restoreAnchorOffset(reason : string) : void {
        let {sw} = this.props;
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            return;
        }
        if (sw.anchorLine == null || sw.anchorLine == 0) {
            return;
        }
        let anchorElem = linesElem.querySelector(sprintf(".line[data-linenum=\"%d\"]", sw.anchorLine));
        if (anchorElem == null) {
            return;
        }
        let scrollTop = linesElem.scrollTop;
        let height = linesElem.clientHeight;
        let containerBottom = scrollTop + height;
        let curAnchorOffset = containerBottom - (anchorElem.offsetTop + anchorElem.offsetHeight);
        if (curAnchorOffset != sw.anchorOffset) {
            let offsetDiff = curAnchorOffset - sw.anchorOffset;
            let newScrollTop = scrollTop - offsetDiff;
            // console.log("update scrolltop", reason, "line=" + sw.anchorLine, -offsetDiff, linesElem.scrollTop, "=>", newScrollTop);
            linesElem.scrollTop = newScrollTop;
            this.ignoreNextScroll = true;
        }
    }

    componentDidMount() : void {
        let {sw, lines} = this.props;
        if (sw.anchorLine == null) {
            this.computeAnchorLine();
        }
        else {
            this.restoreAnchorOffset("re-mount");
        }
        this.lastSelectedLine = sw.selectedLine.get();
        this.lastLinesLength = lines.length;

        let linesElem = this.linesRef.current;
        if (linesElem != null) {
            this.lastOffsetHeight = linesElem.offsetHeight;
            this.lastOffsetWidth = linesElem.offsetWidth;
            this.rszObs = new ResizeObserver(this.handleResize.bind(this));
            this.rszObs.observe(linesElem);
        }

        mobx.action(() => {
            this.staticRender.set(false)
            this.computeVisibleMap();
        })();
    }

    getLineElem(lineNum : number) : HTMLElement {
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            return null;
        }
        let elem = linesElem.querySelector(sprintf(".line[data-linenum=\"%d\"]", lineNum));
        return elem;
    }

    getLineViewInfo(lineNum : number) : {height: number, topOffset: number, botOffset: number, anchorOffset: number} {
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            return null;
        }
        let lineElem = this.getLineElem(lineNum);
        if (lineElem == null) {
            return null;
        }
        let rtn = {
            height: lineElem.offsetHeight,
            topOffset: 0,
            botOffset: 0,
            anchorOffset: 0,
        };
        let containerTop = linesElem.scrollTop;
        let containerBot = linesElem.scrollTop + linesElem.clientHeight;
        let lineTop = lineElem.offsetTop;
        let lineBot = lineElem.offsetTop + lineElem.offsetHeight;
        if (lineTop < containerTop) {
            rtn.topOffset = lineTop - containerTop;
        }
        else if (lineTop > containerBot) {
            rtn.topOffset = lineTop - containerBot;
        }
        if (lineBot < containerTop) {
            rtn.botOffset = lineBot - containerTop;
        }
        else if (lineBot > containerBot) {
            rtn.botOffset = lineBot - containerBot;
        }
        rtn.anchorOffset = containerBot - lineBot;
        return rtn;
    }

    updateSelectedLine() : void {
        let {sw, lines} = this.props;
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            return null;
        }
        let newLine = sw.selectedLine.get();
        this.setLineVisible(newLine, true);
        // console.log("update selected line", this.lastSelectedLine, "=>", newLine, sprintf("anchor=%d:%d", sw.anchorLine, sw.anchorOffset));
        let viewInfo = this.getLineViewInfo(newLine);
        if (viewInfo == null) {
            return;
        }
        sw.setAnchorFields(newLine, viewInfo.anchorOffset, "updateSelectedLine");
        let isFirst = (newLine == lines[0].linenum);
        let isLast = (newLine == lines[lines.length-1].linenum);
        if (viewInfo.botOffset > 0) {
            linesElem.scrollTop = linesElem.scrollTop + viewInfo.botOffset + (isLast ? 10 : 0);
            this.ignoreNextScroll = true;
            sw.anchorOffset = (isLast ? 10 : 0);
        }
        else if (viewInfo.topOffset < 0) {
            linesElem.scrollTop = linesElem.scrollTop + viewInfo.topOffset + (isFirst ? -10 : 0);
            this.ignoreNextScroll = true;
            sw.anchorOffset = linesElem.clientHeight - viewInfo.height;
        }
        // console.log("new anchor", sw.getAnchorStr());
    }

    setLineVisible(lineNum : number, vis : boolean) : void {
        mobx.action(() => {
            let key = String(lineNum);
            let visObj = this.visibleMap.get(key);
            if (visObj == null) {
                visObj = mobx.observable.box(true, {name: "lines-vis-map"});
                this.visibleMap.set(key, visObj);
            }
            else {
                visObj.set(true);
            }
        })();
    }

    componentDidUpdate(prevProps, prevState, snapshot) : void {
        let {sw, lines} = this.props;
        if (sw.selectedLine.get() != this.lastSelectedLine) {
            this.updateSelectedLine();
            this.lastSelectedLine = sw.selectedLine.get();
        } else if (lines.length != this.lastLinesLength) {
            this.restoreAnchorOffset("line-length-change");
        }
    }

    componentWillUnmount() : void {
        if (this.rszObs != null) {
            this.rszObs.disconnect();
        }
    }

    handleResize(entries : any) {
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            return;
        }
        let heightDiff = linesElem.offsetHeight - this.lastOffsetHeight;
        if (heightDiff != 0) {
            linesElem.scrollTop = linesElem.scrollTop - heightDiff;
            this.lastOffsetHeight = linesElem.offsetHeight;
            this.ignoreNextScroll = true;
        }
        if (this.lastOffsetWidth != linesElem.offsetWidth) {
            this.restoreAnchorOffset("resize-width");
            this.lastOffsetWidth = linesElem.offsetWidth;
        }
        this.computeVisibleMap_debounced();
    }

    @boundMethod
    onHeightChange(lineNum : number, newHeight : number, oldHeight : number) : void {
        // console.log("height-change", lineNum, oldHeight, "=>", newHeight);
        this.restoreAnchorOffset("height-change");
        this.computeVisibleMap_debounced();
    }
    
    render() {
        let {sw, width, lines} = this.props;
        let selectedLine = sw.selectedLine.get();  // for re-rendering
        let line : LineType = null;
        let idx : number = 0;
        for (let i=0; i<lines.length; i++) {
            let key = String(lines[i].linenum);
            let visObs = this.visibleMap.get(key);
            if (visObs == null) {
                this.visibleMap.set(key, mobx.observable.box(false, {name: "lines-vis-map"}));
            }
        }
        return (
            <div key="lines" className="lines" onScroll={this.scrollHandler} ref={this.linesRef}>
                <div className="lines-spacer"></div>
                <For each="line" of={lines} index="idx">
                    <Line key={line.lineid} line={line} sw={sw} width={width} visible={this.visibleMap.get(String(line.linenum))} staticRender={this.staticRender.get()} onHeightChange={this.onHeightChange}/>
                </For>
            </div>
        );
    }
}

// sw is not null
@mobxReact.observer
class ScreenWindowView extends React.Component<{sw : ScreenWindow}, {}> {
    rszObs : any;
    windowViewRef : React.RefObject<any>;

    width : mobx.IObservableValue<number> = mobx.observable.box(0, {name: "sw-view-width"});
    height : mobx.IObservableValue<number> = mobx.observable.box(0, {name: "sw-view-height"});
    setSize_debounced : (width : number, height : number) => void;

    constructor(props : any) {
        super(props);
        this.setSize_debounced = debounce(1000, this.setSize.bind(this));
        this.windowViewRef = React.createRef();
    }

    setSize(width : number, height : number) : void {
        mobx.action(() => {
            this.width.set(width);
            this.height.set(height);
            let {sw} = this.props;
            let cols = widthToCols(width);
            let rows = termRowsFromHeight(height);
            if (sw == null || cols == 0 || rows == 0) {
                return;
            }
            sw.termSizeCallback(rows, cols);
        })();
    }

    componentDidMount() {
        let wvElem = this.windowViewRef.current;
        if (wvElem != null) {
            let width = wvElem.offsetWidth;
            let height = wvElem.offsetHeight;
            this.setSize(width, height);
            this.rszObs = new ResizeObserver(this.handleResize.bind(this));
            this.rszObs.observe(wvElem);
        }
    }

    componentWillUnmount() {
        if (this.rszObs) {
            this.rszObs.disconnect();
        }
    }

    handleResize(entries : any) {
        if (entries.length == 0) {
            return;
        }
        let entry = entries[0];
        let width = entry.target.offsetWidth;
        let height = entry.target.offsetHeight;
        this.setSize_debounced(width, height);
    }

    getWindow() : Window {
        let {sw} = this.props;
        let win = GlobalModel.getWindowById(sw.sessionId, sw.windowId);
        if (win == null) {
            win = GlobalModel.loadWindow(sw.sessionId, sw.windowId);
        }
        return win;
    }

    getWindowViewStyle() : any {
        return {position: "absolute", width: "100%", height: "100%", overflowX: "hidden"};
    }

    renderError(message : string) {
        let {sw} = this.props;
        return (
            <div className="window-view" style={this.getWindowViewStyle()} ref={this.windowViewRef} data-windowid={sw.windowId}>
                <div key="window-tag" className="window-tag">
                    <span>{sw.name.get()}</span>
                </div>
                <div key="lines" className="lines"></div>
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
        let isActive = sw.isActive();
        let selectedLine = sw.selectedLine.get();
        return (
            <div className="window-view" style={this.getWindowViewStyle()} ref={this.windowViewRef}>
                <div key="window-tag" className={cn("window-tag", {"is-active": isActive})}>
                    <span>{sw.name.get()}</span>
                </div>
                <If condition={win.lines.length > 0}>
                    <LinesView sw={sw} width={this.width.get()} lines={win.lines}/>
                </If>
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
        let showingScreens = [];
        let activeScreenId = session.activeScreenId.get();
        for (let screen of session.screens) {
            if (!screen.archived.get() || activeScreenId == screen.screenId) {
                showingScreens.push(screen);
            }
        }
        return (
            <div className="screen-tabs">
                <For each="screen" index="index" of={showingScreens}>
                    <div key={screen.screenId} className={cn("screen-tab", {"is-active": activeScreenId == screen.screenId, "is-archived": screen.archived.get()}, "color-" + screen.getTabColor())} onClick={() => this.handleSwitchScreen(screen.screenId)} onContextMenu={(event) => this.handleContextMenu(event, screen.screenId)}>
                        <If condition={screen.archived.get()}><i title="archived" className="fa fa-archive"/></If>{screen.name.get()}
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
        let cmdInputHeight = model.inputModel.cmdInputHeight.get();
        if (cmdInputHeight == 0) {
            cmdInputHeight = 110;
        }
        return (
            <div className="session-view" data-sessionid={session.sessionId}>
                <ScreenView screen={activeScreen}/>
                <ScreenTabs session={session}/>
                <div style={{height: cmdInputHeight}}></div>
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
        let sw : ScreenWindow = null;
        if (GlobalModel.debugSW.get()) {
            sw = GlobalModel.getActiveSW();
        }
        let session : Session = null;
        let remotes = model.remotes ?? [];
        let remote : RemoteType = null;
        let idx : number = 0;
        remotes = sortAndFilterRemotes(remotes);
        let sessionList = [];
        for (let session of model.sessionList) {
            if (!session.archived.get() || session.sessionId == activeSessionId) {
                sessionList.push(session);
            }
        }
        let isCollapsed = this.collapsed.get();
        return (
            <div className={cn("main-sidebar", {"collapsed": isCollapsed})}>
                <h1 className={cn("title", "prompt-logo-small", {"collapsed": isCollapsed})}>
                    {(isCollapsed ? "[p]" : "[prompt]")}
                </h1>
                <div className="collapse-container">
                    <div className="arrow-container" onClick={this.toggleCollapsed}>
                        <If condition={!isCollapsed}><i className="fa fa-arrow-left"/></If>
                        <If condition={isCollapsed}><i className="fa fa-arrow-right"/></If>
                    </div>
                </div>
                <div className="menu">
                    <p className="menu-label">
                        Private Sessions
                    </p>
                    <ul className="menu-list">
                        <If condition={!model.sessionListLoaded.get()}>
                            <li className="menu-loading-message"><a>(loading)</a></li>
                        </If>
                        <If condition={model.sessionListLoaded.get()}>
                            <For each="session" index="idx" of={sessionList}>
                                <li key={session.sessionId}><a className={cn({"is-active": activeSessionId == session.sessionId})} onClick={() => this.handleSessionClick(session.sessionId)}>
                                    <If condition={!session.archived.get()}>
                                        <span className="session-num">{idx+1}&nbsp;</span>
                                    </If>
                                    <If condition={session.archived.get()}>
                                        <i title="archived" className="fa fa-archive"/>&nbsp;
                                    </If>
                                    {session.name.get()}
                                </a></li>
                            </For>
                            <li className="new-session"><a onClick={() => this.handleNewSession()}><i className="fa fa-plus"/> New Session</a></li>
                        </If>
                    </ul>
                    <div className="spacer"></div>
                    <If condition={GlobalModel.debugSW.get() && sw != null}>
                        <div>
                            focus={sw.focusType.get()}<br/>
            sline={sw.selectedLine.get()}<br/>
            termfocus={sw.termLineNumFocus.get()}<br/>
                        </div>
                    </If>
                    <p className="menu-label">
                        <a onClick={() => this.clickRemotes()}>Links</a>
                    </p>
                    <ul className="menu-list">
                        <li>
                            <a target="_blank" href="https://docs.getprompt.dev/"><i className="fa fa-book"/> documentation</a>
                        </li>
                        <li>
                            <a target="_blank" href="https://discord.gg/XfvZ334gwU"><i className="fa fa-comments"/> discord</a>
                        </li>
                    </ul>
                    <p className="menu-label">
                        <a onClick={() => this.clickRemotes()}>Connections</a>
                    </p>
                    <ul className="menu-list remotes-menu-list">
                        <For each="remote" of={remotes}>
                            <li key={remote.remoteid} className={cn("remote-menu-item")}><a className={cn({"is-active": (remote.remoteid == activeRemoteId)})} onClick={() => this.clickRemote(remote)}>
                                <RemoteStatusLight remote={remote}/>
                                {this.remoteDisplayName(remote)}
                            </a></li>
                        </For>
                        <li key="add-remote" className="add-remote">
                            <a onClick={() => this.handleAddRemote()}><i className="fa fa-plus"/> Add Connection</a>
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
class DisconnectedModal extends React.Component<{}, {}> {
    logRef : any = React.createRef();
    showLog : mobx.IObservableValue<boolean> = mobx.observable.box(false)
    
    @boundMethod
    restartServer() {
        GlobalModel.restartLocalServer();
    }

    @boundMethod
    tryReconnect() {
        GlobalModel.ws.connectNow("manual");
    }

    componentDidMount() {
        if (this.logRef.current != null) {
            this.logRef.current.scrollTop = this.logRef.current.scrollHeight;
        }
    }

    componentDidUpdate() {
        if (this.logRef.current != null) {
            this.logRef.current.scrollTop = this.logRef.current.scrollHeight;
        }
    }

    @boundMethod
    handleShowLog() : void {
        mobx.action(() => {
            this.showLog.set(!this.showLog.get());
        })();
    }
    
    render() {
        let model = GlobalModel;
        let logLine : string = null;
        let idx : number = 0;
        return (
            <div className="sc-modal disconnected-modal modal is-active">
                <div className="modal-background"></div>
                <div className="modal-content message">
                    <div className="message-header">
                        <p>Prompt Client Disconnected</p>
                    </div>
                    <If condition={this.showLog.get()}>
                        <div className="message-content">
                            <div className="ws-log" ref={this.logRef}>
                                <For each="logLine" index="idx" of={GlobalModel.ws.wsLog}>
                                    <div key={idx} className="ws-logline">{logLine}</div>
                                </For>
                            </div>
                        </div>
                    </If>
                    <div className="message-footer">
                        <div className="footer-text-link" style={{marginLeft: 10}} onClick={this.handleShowLog}>
                            <If condition={!this.showLog.get()}>
                                <i className="fa fa-plus"/> Show Log
                            </If>
                            <If condition={this.showLog.get()}>
                                <i className="fa fa-minus"/> Hide Log
                            </If>
                        </div>
                        <div className="spacer"/>
                        <button onClick={this.tryReconnect} className="button">
                            <span className="icon">
                                <i className="fa fa-refresh"/>
                            </span>
                            <span>Try Reconnect</span>
                        </button>
                        <button onClick={this.restartServer} className="button is-danger" style={{marginLeft: 10}}>
                            <span className="icon">
                                <i className="fa fa-exclamation-triangle"/>
                            </span>
                            <span>Restart Server</span>
                        </button>
                    </div>
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
                <div className="main-content">
                    <MainSideBar/>
                    <SessionView/>
                </div>
                <If condition={!GlobalModel.ws.open.get() || !GlobalModel.localServerRunning.get()}>
                    <DisconnectedModal/>
                </If>
            </div>
        );
    }
}

export {Main};

