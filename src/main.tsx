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
import type {SessionDataType, LineType, CmdDataType, RemoteType, RemoteStateType, RemoteInstanceType, RemotePtrType, HistoryItem, HistoryQueryOpts, RemoteEditType, FeStateType, ContextMenuOpts, BookmarkType, RenderModeType} from "./types";
import type * as T from "./types";
import localizedFormat from 'dayjs/plugin/localizedFormat';
import {GlobalModel, GlobalCommandRunner, Session, Cmd, Window, Screen, riToRPtr, windowWidthToCols, windowHeightToRows, termHeightFromRows, termWidthFromCols} from "./model";
import {isModKeyPress} from "./util";
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {BookmarksView} from "./bookmarks";
import {HistoryView} from "./history";
import {Line, Prompt} from "./linecomps";

dayjs.extend(localizedFormat)

const RemotePtyRows = 8;
const RemotePtyCols = 80;
const PasswordUnchangedSentinel = "--unchanged--";
const LinesVisiblePadding = 500;

const RemoteColors = ["red", "green", "yellow", "blue", "magenta", "cyan", "white", "orange"];

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K,V> = mobx.ObservableMap<K,V>;

type VisType = "visible" | "";

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

function getTodayStr() : string {
    return getDateStr(new Date());
}

function getYesterdayStr() : string {
    let d = new Date();
    d.setDate(d.getDate()-1);
    return getDateStr(d);
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

@mobxReact.observer
class TextAreaInput extends React.Component<{onHeightChange : () => void}, {}> {
    lastTab : boolean = false;
    lastHistoryUpDown : boolean = false;
    lastTabCurLine : mobx.IObservableValue<string> = mobx.observable.box(null);
    lastFocusType : string = null;
    mainInputRef : React.RefObject<any>;
    historyInputRef : React.RefObject<any>;
    controlRef : React.RefObject<any>;
    lastHeight : number = 0;

    constructor(props) {
        super(props);
        this.mainInputRef = React.createRef();
        this.historyInputRef = React.createRef();
        this.controlRef = React.createRef();
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

    checkHeight(shouldFire : boolean) : void {
        let elem = this.controlRef.current;
        if (elem == null) {
            return;
        }
        let curHeight = elem.offsetHeight;
        if (this.lastHeight == curHeight) {
            return;
        }
        this.lastHeight = curHeight;
        if (shouldFire && this.props.onHeightChange != null) {
            this.props.onHeightChange();
        }
    }

    componentDidMount() {
        let activeScreen = GlobalModel.getActiveScreen();
        if (activeScreen != null) {
            let focusType = activeScreen.focusType.get();
            if (focusType == "input") {
                this.setFocus();
            }
            this.lastFocusType = focusType;
        }
        this.checkHeight(false);
    }

    componentDidUpdate() {
        let activeScreen = GlobalModel.getActiveScreen();
        if (activeScreen != null) {
            let focusType = activeScreen.focusType.get();
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
        this.checkHeight(true);
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
                    if (GlobalModel.inputModel.isEmpty()) {
                        let activeWindow = GlobalModel.getActiveWindow();
                        let activeScreen = GlobalModel.getActiveScreen();
                        if (activeScreen != null && activeWindow != null && activeWindow.lines.length > 0) {
                            activeScreen.setSelectedLine(0);
                            GlobalCommandRunner.screenSelectLine("E");
                        }
                        return;
                    }
                    else {
                        setTimeout(() => GlobalModel.inputModel.uiSubmitCommand(), 0);
                        return;
                    }
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
            if (e.code == "KeyU" && e.getModifierState("Control")) {
                e.preventDefault();
                this.controlU();
                return;
            }
            if (e.code == "KeyY" && e.getModifierState("Control")) {
                e.preventDefault();
                this.controlY();
                return;
            }
            if (e.code == "KeyR" && e.getModifierState("Control")) {
                e.preventDefault();
                inputModel.openHistory();
                return;
            }
            if (e.code == "ArrowUp" && e.getModifierState("Shift")) {
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
    controlU() {
        if (this.mainInputRef.current == null) {
            return;
        }
        let selStart = this.mainInputRef.current.selectionStart;
        let value = this.mainInputRef.current.value;
        if (selStart > value.length) {
            return;
        }
        let cutValue = value.substr(0, selStart);
        let restValue = value.substr(selStart);
        let cmdLineUpdate = {cmdline: restValue, cursorpos: 0};
        console.log("ss", selStart, value, "[" + cutValue + "]", "[" + restValue + "]");
        navigator.clipboard.writeText(cutValue);
        GlobalModel.inputModel.updateCmdLine(cmdLineUpdate);
    }

    @boundMethod
    controlY() {
        if (this.mainInputRef.current == null) {
            return;
        }
        let pastePromise = navigator.clipboard.readText();
        pastePromise.then((clipText) => {
            clipText = clipText ?? "";
            let selStart = this.mainInputRef.current.selectionStart;
            let selEnd = this.mainInputRef.current.selectionEnd;
            let value = this.mainInputRef.current.value;
            if (selStart > value.length || selEnd > value.length) {
                return;
            }
            let newValue = value.substr(0, selStart) + clipText + value.substr(selEnd);
            let cmdLineUpdate = {cmdline: newValue, cursorpos: selStart+clipText.length};
            GlobalModel.inputModel.updateCmdLine(cmdLineUpdate);
        });
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
        let activeScreen = GlobalModel.getActiveScreen();
        if (activeScreen != null) {
            activeScreen.focusType.get(); // for reaction
        }
        return (
            <div className="control cmd-input-control is-expanded" ref={this.controlRef}>
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
            return null;
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
                statusStr = "mshell " + remote.mshellversion + " (needs upgrade)";
            }
            else if (isBlank(remote.mshellversion)) {
                statusStr = "mshell unknown";
            }
            else {
                statusStr = "mshell " + remote.mshellversion + " (current)";
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
            inputModel.remoteTermWrap.giveFocus();
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
        let termFontSize = GlobalModel.termFontSize.get();
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
                <div key="term" className={cn("terminal-wrapper", {"focus": isTermFocused}, (remote != null ? "status-" + remote.status : null))} style={{display: (ptyRemoteId == null ? "none" : "block"), width: termWidthFromCols(RemotePtyCols, termFontSize)}}>
                    <If condition={!isTermFocused}>
                        <div key="termblock" className="term-block" onClick={this.clickTermBlock}></div>
                    </If>
                    <If condition={inputModel.showNoInputMsg.get()}>
                        <div key="termtag" className="term-tag">input is only allowed while status is 'connecting'</div>
                    </If>
                    <div key="terminal" className="terminal-connectelem" id="term-remote" data-remoteid={ptyRemoteId} style={{height: termHeightFromRows(RemotePtyRows, termFontSize)}}></div>
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
                                <i onClick={this.resetPw} title="restore to original password" className="icon fa-sharp fa-solid fa-rotate-left undo-icon"/>
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

    hasSpace(s : string) : boolean {
        return s.indexOf(" ") != -1;
    }

    handleCompClick(s : string) : void {
        // TODO -> complete to this completion
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
                            <div onClick={() => this.handleCompClick(istr)} key={idx} className={cn("info-comp", {"has-space": this.hasSpace(istr)}, {"metacmd-comp": istr.startsWith("^")})}>
                                {this.getAfterSlash(istr)}
                            </div>
                        </For>
                        <If condition={infoMsg.infocompsmore}>
                            <div key="more" className="info-comp no-select">
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
        this.updateCmdInputHeight();
    }

    updateCmdInputHeight() {
        let elem = this.cmdInputRef.current;
        if (elem == null) {
            return;
        }
        let height = elem.offsetHeight;
        if (height == GlobalModel.inputModel.cmdInputHeight) {
            return;
        }
        mobx.action(() => {
            GlobalModel.inputModel.cmdInputHeight.set(height);
        })();
    }

    componentDidUpdate(prevProps, prevState, snapshot : {}) : void {
        this.updateCmdInputHeight();
    }

    @boundMethod
    handleInnerHeightUpdate() : void {
        this.updateCmdInputHeight();
    }

    @boundMethod
    clickFocusInputHint() : void {
        GlobalModel.inputModel.giveFocus();
    }

    @boundMethod
    clickHistoryHint() : void {
        let inputModel = GlobalModel.inputModel;
        if (inputModel.historyShow.get()) {
            inputModel.resetHistory();
        }
        else {
            inputModel.openHistory();
        }
    }
    
    render() {
        let model = GlobalModel;
        let inputModel = model.inputModel;
        let screen = GlobalModel.getActiveScreen();
        let ri : RemoteInstanceType = null;
        let rptr : RemotePtrType = null;
        if (screen != null) {
            ri = screen.getCurRemoteInstance();
            rptr = screen.curRemote.get();
        }
        let remote : RemoteType = null;
        let remoteState : FeStateType = null;
        if (ri != null) {
            remote = GlobalModel.getRemote(ri.remoteid);
            remoteState = ri.festate;
        }
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
                        <i className="fa-sharp fa-solid fa-chevron-down"/>
                    </If>
                    <If condition={!(infoShow || historyShow) && hasInfo}>
                        <i className="fa-sharp fa-solid fa-chevron-up"/>
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
                    <TextAreaInput onHeightChange={this.handleInnerHeightUpdate}/>
                    <div className="control cmd-exec">
                        <div onClick={GlobalModel.inputModel.uiSubmitCommand} className="button" title="Run Command">
                            <span className="icon">
                                <i className="fa-sharp fa-solid fa-rocket"/>
                            </span>
                        </div>
                    </div>
                    <div className="cmd-input-hints">
                        <If condition={!focusVal}><div onClick={this.clickFocusInputHint} className="hint-item color-white">focus input (&#x2318;I)</div></If>
                        <If condition={focusVal}><div onClick={this.clickHistoryHint} className="hint-item color-green"><i className={cn("fa-sharp fa-solid", (historyShow ? "fa-angle-down" : "fa-angle-up"))}/> {historyShow ? "close history (esc)" : "show history (ctrl-r)"}</div></If>
                    </div>
                </div>
            </div>
        );
    }
}

const DOW_STRS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getDateStr(d : Date) : string {
    let yearStr = String(d.getFullYear());
    let monthStr = String(d.getMonth()+1);
    if (monthStr.length == 1) {
        monthStr = "0" + monthStr;
    }
    let dayStr = String(d.getDate());
    if (dayStr.length == 1) {
        dayStr = "0" + dayStr;
    }
    let dowStr = DOW_STRS[d.getDay()];
    return dowStr + " " + yearStr + "-" + monthStr + "-" + dayStr;
}

function getLineDateStr(todayDate : string, yesterdayDate : string, ts : number) : string {
    let lineDate = new Date(ts);
    let dateStr = getDateStr(lineDate);
    if (dateStr == todayDate) {
        return "today";
    }
    if (dateStr == yesterdayDate) {
        return "yesterday";
    }
    return dateStr;
}

@mobxReact.observer
class LinesView extends React.Component<{screen : Screen, width : number, lines : LineType[], renderMode : RenderModeType}, {}> {
    rszObs : any;
    linesRef : React.RefObject<any>;
    staticRender : OV<boolean> = mobx.observable.box(true, {name: "static-render"});
    lastOffsetHeight : number = 0;
    lastOffsetWidth : number = 0;
    ignoreNextScroll : boolean = false;
    visibleMap : Map<string, OV<boolean>>;  // lineid => OV<vis>
    collapsedMap : Map<string, OV<boolean>>;  // lineid => OV<collapsed>
    lastLinesLength : number = 0;
    lastSelectedLine : number = 0;

    computeAnchorLine_throttled : () => void;
    computeVisibleMap_debounced : () => void;

    constructor(props) {
        super(props);
        this.linesRef = React.createRef();
        this.computeAnchorLine_throttled = throttle(100, this.computeAnchorLine.bind(this), {noLeading: true, noTrailing: false});
        this.visibleMap = new Map();
        this.collapsedMap = new Map();
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
        let {screen} = this.props;
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            screen.setAnchorFields(null, 0, "no-lines");
            return;
        }
        let lineElemArr = linesElem.querySelectorAll(".line");
        if (lineElemArr == null || lineElemArr.length == 0) {
            screen.setAnchorFields(null, 0, "no-line");
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
        screen.setAnchorFields(parseInt(anchorElem.dataset.linenum), containerBottom - (anchorElem.offsetTop + anchorElem.offsetHeight), "computeAnchorLine");
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
        // console.log("computevismap", linesElem.scrollTop, linesElem.clientHeight, containerTop + "-" + containerBot);
        for (let i=0; i<lineElemArr.length; i++) {
            let lineElem = lineElemArr[i];
            let lineTop = lineElem.offsetTop;
            let lineBot = lineElem.offsetTop + lineElem.offsetHeight;
            let isVis = false;
            if (lineTop >= containerTop && lineTop <= containerBot) {
                isVis = true;
            }
            if (lineBot >= containerTop && lineBot <= containerBot) {
                isVis = true
            }
            newMap.set(lineElem.dataset.linenum, isVis);
            // console.log("setvis", sprintf("%4d %4d-%4d (%4d) %s", lineElem.dataset.linenum, lineTop, lineBot, lineElem.offsetHeight, isVis));
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
        let {screen} = this.props;
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            return;
        }
        if (screen.anchorLine == null || screen.anchorLine == 0) {
            return;
        }
        let anchorElem = linesElem.querySelector(sprintf(".line[data-linenum=\"%d\"]", screen.anchorLine));
        if (anchorElem == null) {
            return;
        }
        let isLastLine = screen.isLastLine(screen.anchorLine);
        let scrollTop = linesElem.scrollTop;
        let height = linesElem.clientHeight;
        let containerBottom = scrollTop + height;
        let curAnchorOffset = containerBottom - (anchorElem.offsetTop + anchorElem.offsetHeight);
        let newAnchorOffset = screen.anchorOffset;
        if (isLastLine && newAnchorOffset == 0) {
            newAnchorOffset = 10;
        }
        if (curAnchorOffset != newAnchorOffset) {
            let offsetDiff = curAnchorOffset - newAnchorOffset;
            let newScrollTop = scrollTop - offsetDiff;
            // console.log("update scrolltop", reason, "line=" + screen.anchorLine, -offsetDiff, linesElem.scrollTop, "=>", newScrollTop);
            linesElem.scrollTop = newScrollTop;
            this.ignoreNextScroll = true;
        }
    }

    componentDidMount() : void {
        let {screen, lines} = this.props;
        let linesElem = this.linesRef.current;
        let anchorLineObj = screen.getLineByNum(screen.anchorLine);
        if (anchorLineObj == null) {
            // scroll to bottom
            if (linesElem != null) {
                linesElem.scrollTop = linesElem.clientHeight;
            }
            this.computeAnchorLine();
        }
        else {
            this.restoreAnchorOffset("re-mount");
        }
        this.lastSelectedLine = screen.getSelectedLine();
        this.lastLinesLength = lines.length;

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
        let {screen, lines} = this.props;
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            return null;
        }
        let newLine = screen.getSelectedLine();
        if (newLine == 0) {
            return;
        }
        this.setLineVisible(newLine, true);
        // console.log("update selected line", this.lastSelectedLine, "=>", newLine, sprintf("anchor=%d:%d", screen.anchorLine, screen.anchorOffset));
        let viewInfo = this.getLineViewInfo(newLine);
        if (viewInfo == null) {
            return;
        }
        screen.setAnchorFields(newLine, viewInfo.anchorOffset, "updateSelectedLine");
        let isFirst = (newLine == lines[0].linenum);
        let isLast = (newLine == lines[lines.length-1].linenum);
        if (viewInfo.botOffset > 0) {
            linesElem.scrollTop = linesElem.scrollTop + viewInfo.botOffset + (isLast ? 10 : 0);
            this.ignoreNextScroll = true;
            screen.anchorOffset = (isLast ? 10 : 0);
        }
        else if (viewInfo.topOffset < 0) {
            linesElem.scrollTop = linesElem.scrollTop + viewInfo.topOffset + (isFirst ? -10 : 0);
            this.ignoreNextScroll = true;
            screen.anchorOffset = linesElem.clientHeight - viewInfo.height;
        }
        // console.log("new anchor", screen.getAnchorStr());
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
        let {screen, lines} = this.props;
        if (screen.getSelectedLine() != this.lastSelectedLine) {
            this.updateSelectedLine();
            this.lastSelectedLine = screen.getSelectedLine();
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

    hasTopBorder(lines : LineType[], idx : number) : boolean {
        if (idx == 0) {
            return false;
        }
        let curLineNumStr = String(lines[idx].linenum);
        let prevLineNumStr = String(lines[idx-1].linenum);
        return !this.collapsedMap.get(curLineNumStr).get() || !this.collapsedMap.get(prevLineNumStr).get();
    }

    getDateSepStr(lines : LineType[], idx : number, prevStr : string, todayStr : string, yesterdayStr : string) : string {
        let curLineDate = new Date(lines[idx].ts);
        let curLineFormat = dayjs(curLineDate).format("ddd YYYY-MM-DD");
        if (idx == 0) {
            return ;
        }
        let prevLineDate = new Date(lines[idx].ts);
        let prevLineFormat = dayjs(prevLineDate).format("YYYY-MM-DD");
        return null;
    }
    
    render() {
        let {screen, width, lines, renderMode} = this.props;
        let selectedLine = screen.getSelectedLine();  // for re-rendering
        let line : LineType = null;
        for (let i=0; i<lines.length; i++) {
            let key = String(lines[i].linenum);
            let visObs = this.visibleMap.get(key);
            if (visObs == null) {
                this.visibleMap.set(key, mobx.observable.box(false, {name: "lines-vis-map"}));
            }
            let collObs = this.collapsedMap.get(key);
            if (collObs == null) {
                this.collapsedMap.set(key, mobx.observable.box(false, {name: "lines-collapsed-map"}));
            }
        }
        let lineElements : any = [];
        let todayStr = getTodayStr();
        let yesterdayStr = getYesterdayStr();
        let prevDateStr : string = null;
        for (let idx=0; idx<lines.length; idx++) {
            let line = lines[idx];
            let lineNumStr = String(line.linenum);
            let dateSepStr = null;
            let curDateStr = getLineDateStr(todayStr, yesterdayStr, line.ts);
            if (curDateStr != prevDateStr) {
                dateSepStr = curDateStr;
            }
            prevDateStr = curDateStr;
            if (dateSepStr != null) {
                let sepElem = <div key={"sep-" + line.lineid} className="line-sep">{dateSepStr}</div>
                lineElements.push(sepElem);
            }
            let topBorder = (dateSepStr == null) && this.hasTopBorder(lines, idx);
            let lineElem = <Line key={line.lineid} line={line} screen={screen} width={width} visible={this.visibleMap.get(lineNumStr)} staticRender={this.staticRender.get()} onHeightChange={this.onHeightChange} overrideCollapsed={this.collapsedMap.get(lineNumStr)} topBorder={topBorder} renderMode={renderMode}/>;
            lineElements.push(lineElem);
        }
        return (
            <div key="lines" className="lines" onScroll={this.scrollHandler} ref={this.linesRef}>
                <div className="lines-spacer"></div>
                {lineElements}
            </div>
        );
    }
}

// screen is not null
@mobxReact.observer
class ScreenWindowView extends React.Component<{screen : Screen}, {}> {
    rszObs : any;
    windowViewRef : React.RefObject<any>;

    width : mobx.IObservableValue<number> = mobx.observable.box(0, {name: "sw-view-width"});
    height : mobx.IObservableValue<number> = mobx.observable.box(0, {name: "sw-view-height"});
    setSize_debounced : (width : number, height : number) => void;

    renderMode : OV<RenderModeType> = mobx.observable.box("normal", {name: "renderMode"});

    constructor(props : any) {
        super(props);
        this.setSize_debounced = debounce(1000, this.setSize.bind(this));
        this.windowViewRef = React.createRef();
    }

    setSize(width : number, height : number) : void {
        let {screen} = this.props;
        if (screen == null) {
            return;
        }
        mobx.action(() => {
            this.width.set(width);
            this.height.set(height);
            let cols = windowWidthToCols(width, GlobalModel.termFontSize.get());
            let rows = windowHeightToRows(height, GlobalModel.termFontSize.get());
            if (cols == 0 || rows == 0) {
                console.log("cannot set screen size", rows, cols);
                return;
            }
            screen.termSizeCallback(rows, cols);
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
        let {screen} = this.props;
        let win = GlobalModel.getWindowById(screen.sessionId, screen.windowId);
        if (win == null) {
            win = GlobalModel.loadWindow(screen.sessionId, screen.screenId, screen.windowId);
        }
        return win;
    }

    getWindowViewStyle() : any {
        return {position: "absolute", width: "100%", height: "100%", overflowX: "hidden"};
    }

    @boundMethod
    toggleRenderMode() {
        let renderMode = this.renderMode.get();
        mobx.action(() => {
            this.renderMode.set(renderMode == "normal" ? "collapsed" : "normal");
        })();
    }

    renderError(message : string, fade : boolean) {
        let {screen} = this.props;
        return (
            <div className="window-view" style={this.getWindowViewStyle()} ref={this.windowViewRef} data-windowid={screen.windowId}>
                <div key="window-tag" className="window-tag">
                    <span>{screen.name.get()}</span>
                </div>
                <div key="lines" className="lines"></div>
                <div key="window-empty" className={cn("window-empty", {"should-fade": fade})}>
                    <div>{message}</div>
                </div>
            </div>
        );
    }

    render() {
        let {screen} = this.props;
        let win = this.getWindow();
        if (win == null || !win.loaded.get()) {
            return this.renderError("...", true);
        }
        if (win.loadError.get() != null) {
            return this.renderError(sprintf("(%s)", win.loadError.get()), false);
        }
        if (this.width.get() == 0) {
            return this.renderError("", false);
        }
        let cdata = GlobalModel.clientData.get();
        if (cdata == null) {
            return this.renderError("loading client data", true);
        }
        let idx = 0;
        let line : LineType = null;
        let session = GlobalModel.getSessionById(screen.sessionId);
        let isActive = screen.isActive();
        let selectedLine = screen.getSelectedLine();
        let lines = win.getNonArchivedLines();
        let renderMode = this.renderMode.get();
        return (
            <div className="window-view" style={this.getWindowViewStyle()} ref={this.windowViewRef}>
                <div key="window-tag" className={cn("window-tag", {"is-active": isActive})}>
                    <div className="window-name">{screen.name.get()}</div>
                    <div className="render-mode" onClick={this.toggleRenderMode}>
                        <If condition={renderMode == "normal"}>
                            <i title="collapse" className="fa-sharp fa-solid fa-arrows-to-line"/>
                        </If>
                        <If condition={renderMode == "collapsed"}>
                            <i title="expand" className="fa-sharp fa-solid fa-arrows-from-line"/>
                        </If>
                    </div>
                </div>
                <If condition={lines.length > 0}>
                    <LinesView screen={screen} width={this.width.get()} lines={lines} renderMode={renderMode}/>
                </If>
                <If condition={lines.length == 0}>
                    <div key="window-empty" className="window-empty">
                        <div><code>[session="{session.name.get()}" screen="{screen.name.get()}" window="{screen.name.get()}"]</code></div>
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
        if (screen == null) {
            return (
                <div className="screen-view">
                    (no screen found)
                </div>
            );
        }
        let fontSize = GlobalModel.termFontSize.get();
        return (
            <div className="screen-view" data-screenid={screen.screenId}>
                <ScreenWindowView key={screen.screenId} screen={screen}/>
            </div>
        );
    }
}

@mobxReact.observer
class ScreenTabs extends React.Component<{session : Session}, {}> {
    tabsRef : React.RefObject<any> = React.createRef();
    lastActiveScreenId : string = null;
    scrolling : OV<boolean> = mobx.observable.box(false, {name: "screentabs-scrolling"});

    stopScrolling_debounced : () => void;

    constructor(props : any) {
        super(props);
        this.stopScrolling_debounced = debounce(1500, this.stopScrolling.bind(this));
    }
    
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
    }

    componentDidMount() : void {
        this.componentDidUpdate();
    }

    componentDidUpdate() : void {
        let {session} = this.props;
        let activeScreenId = session.activeScreenId.get();
        if (activeScreenId != this.lastActiveScreenId && this.tabsRef.current) {
            let tabElem = this.tabsRef.current.querySelector(sprintf(".screen-tab[data-screenid=\"%s\"]", activeScreenId));
            if (tabElem != null) {
                tabElem.scrollIntoView();
            }
        }
        this.lastActiveScreenId = activeScreenId;
    }

    stopScrolling() : void {
        mobx.action(() => {
            this.scrolling.set(false);
        })();
    }

    @boundMethod
    handleScroll() {
        if (!this.scrolling.get()) {
            mobx.action(() => {
                this.scrolling.set(true);
            })();
        }
        this.stopScrolling_debounced();
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
        let screens = GlobalModel.getSessionScreens(session.sessionId);
        for (let screen of screens) {
            if (!screen.archived.get() || activeScreenId == screen.screenId) {
                showingScreens.push(screen);
            }
        }
        return (
            <div className={cn("screen-tabs", {"scrolling": this.scrolling.get()})} ref={this.tabsRef} onScroll={this.handleScroll}>
                <For each="screen" index="index" of={showingScreens}>
                    <div key={screen.screenId} data-screenid={screen.screenId} className={cn("screen-tab", {"is-active": activeScreenId == screen.screenId, "is-archived": screen.archived.get()}, "color-" + screen.getTabColor())} onClick={() => this.handleSwitchScreen(screen.screenId)} onContextMenu={(event) => this.handleContextMenu(event, screen.screenId)}>
                        <If condition={screen.archived.get()}><i title="archived" className="fa-sharp fa-solid fa-box-archive"/></If>{screen.name.get()}
                        <If condition={index+1 <= 9}>
                            <div className="tab-index">&#x2318;{index+1}</div>
                        </If>
                    </div>
                </For>
                <div key="new-screen" className="screen-tab new-screen" onClick={this.handleNewScreen}>
                    <i className="fa-sharp fa-solid fa-plus"/> <div className="tab-index">&#x2318;T</div>
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
        let isHidden = (GlobalModel.activeMainView.get() != "session");
        return (
            <div className={cn("session-view", {"is-hidden": isHidden})} data-sessionid={session.sessionId}>
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
        let icon = "fa-sharp fa-solid fa-circle"
        if (status == "connecting") {
            icon = (wfp ? "fa-sharp fa-solid fa-key" : "fa-sharp fa-solid fa-rotate");
        }
        return (
            <i className={cn("remote-status", icon, "status-" + status)}/>
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

    handleNewSharedSession() {
        GlobalCommandRunner.openSharedSession();
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

    @boundMethod
    handleHistoryClick() : void {
        if (GlobalModel.activeMainView.get() == "history") {
            mobx.action(() => {
                GlobalModel.activeMainView.set("session");
            })();
            return;
        }
        GlobalModel.historyViewModel.reSearch();
    }

    @boundMethod
    handlePlaybookClick() : void {
        console.log("playbook click");
        return;
    }

    @boundMethod
    handleBookmarksClick() : void {
        if (GlobalModel.activeMainView.get() == "bookmarks") {
            mobx.action(() => {
                GlobalModel.activeMainView.set("session");
            })();
            return;
        }
        GlobalCommandRunner.bookmarksView();
    }

    @boundMethod
    handleWelcomeClick() : void {
        mobx.action(() => {
            GlobalModel.welcomeModalOpen.set(true);
        })();
    }

    render() {
        let model = GlobalModel;
        let activeSessionId = model.activeSessionId.get();
        let activeWindow = model.getActiveWindow();
        let activeScreen = model.getActiveScreen();
        let activeRemoteId : string = null;
        if (activeScreen != null) {
            let rptr = activeScreen.curRemote.get();
            if (rptr != null && !isBlank(rptr.remoteid)) {
                activeRemoteId = rptr.remoteid;
            }
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
        let mainView = GlobalModel.activeMainView.get();
        let activePlaybookId : string = null;
        return (
            <div className={cn("main-sidebar", {"collapsed": isCollapsed}, {"is-dev": GlobalModel.isDev})}>
                <h1 className={cn("title", "prompt-logo-small", {"collapsed": isCollapsed}, {"is-dev": GlobalModel.isDev})}>
                    {(isCollapsed ? "[p]" : "[prompt]")}
                </h1>
                <div className="collapse-container">
                    <div className="arrow-container" onClick={this.toggleCollapsed}>
                        <If condition={!isCollapsed}><i className="fa-sharp fa-solid fa-arrow-left"/></If>
                        <If condition={isCollapsed}><i className="fa-sharp fa-solid fa-arrow-right"/></If>
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
                                <li key={session.sessionId}><a className={cn({"is-active": mainView == "session" && activeSessionId == session.sessionId})} onClick={() => this.handleSessionClick(session.sessionId)}>
                                    <If condition={!session.archived.get()}>
                                        <span className="session-num">{idx+1}&nbsp;</span>
                                    </If>
                                    <If condition={session.archived.get()}>
                                        <i title="archived" className="fa-sharp fa-solid fa-box-archive"/>&nbsp;
                                    </If>
                                    {session.name.get()}
                                </a></li>
                            </For>
                            <li className="new-session"><a onClick={() => this.handleNewSession()}><i className="fa-sharp fa-solid fa-plus"/> New Session</a></li>
                        </If>
                    </ul>
                    <p className="menu-label">
                        Shared Sessions
                    </p>
                    <ul className="menu-list">
                        <li className="new-session"><a onClick={() => this.handleNewSharedSession()}><i className="fa-sharp fa-solid fa-plus"/> New Session</a></li>
                    </ul>
                    <ul className="menu-list" style={{marginTop: 20}}>
                        <li className="menu-history"><a onClick={this.handleHistoryClick} className={cn({"is-active": (mainView == "history")})}><i className="fa-sharp fa-solid fa-clock"/> HISTORY <span className="hotkey">&#x2318;H</span></a></li>
                    </ul>
                    <ul className="menu-list">
                        <li className="menu-bookmarks"><a onClick={this.handleBookmarksClick} className={cn({"is-active": (mainView == "bookmarks")})}><i className="fa-sharp fa-solid fa-bookmark"/> BOOKMARKS <span className="hotkey">&#x2318;B</span></a></li>
                    </ul>
                    <p className="menu-label display-none">
                        Playbooks
                    </p>
                    <ul className="menu-list display-none">
                        <li key="default"><a onClick={this.handlePlaybookClick}><i className="fa-sharp fa-solid fa-file-lines"/> default</a></li>
                        <li key="prompt-dev"><a onClick={this.handlePlaybookClick}><i className="fa-sharp fa-solid fa-file-lines"/> prompt-dev</a></li>
                    </ul>
                    <div className="spacer"></div>
                    <If condition={GlobalModel.debugScreen.get() && activeScreen != null}>
                        <div>
                            focus={activeScreen.focusType.get()}<br/>
            sline={activeScreen.getSelectedLine()}<br/>
            termfocus={activeScreen.termLineNumFocus.get()}<br/>
                        </div>
                    </If>
                    <ul className="menu-list">
                        <li className="menu-bookmarks"><a onClick={this.handleWelcomeClick} className={cn({"is-active": GlobalModel.welcomeModalOpen.get()})}><i className="fa-sharp fa-solid fa-door-open"/> WELCOME</a></li>
                    </ul>
                    <p className="menu-label">
                        <a onClick={() => this.clickRemotes()}>Links</a>
                    </p>
                    <ul className="menu-list">
                        <li>
                            <a target="_blank" href="https://docs.getprompt.dev/releasenotes"><i style={{width: 20}} className="fa-sharp fa-solid fa-notes"/> release notes</a>
                        </li>
                        <li>
                            <a target="_blank" href="https://docs.getprompt.dev/"><i style={{width: 20}} className="fa-sharp fa-solid fa-book"/> documentation</a>
                        </li>
                        <li>
                            <a target="_blank" href="https://discord.gg/XfvZ334gwU"><i style={{width: 20}} className="fa-brands fa-discord"/> discord</a>
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
                            <a onClick={() => this.handleAddRemote()}><i className="fa-sharp fa-solid fa-plus"/> Add Connection</a>
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
                                <i className="fa-sharp fa-solid fa-plus"/> Show Log
                            </If>
                            <If condition={this.showLog.get()}>
                                <i className="fa-sharp fa-solid fa-minus"/> Hide Log
                            </If>
                        </div>
                        <div className="spacer"/>
                        <button onClick={this.tryReconnect} className="button">
                            <span className="icon">
                                <i className="fa-sharp fa-solid fa-rotate"/>
                            </span>
                            <span>Try Reconnect</span>
                        </button>
                        <button onClick={this.restartServer} className="button is-danger" style={{marginLeft: 10}}>
                            <span className="icon">
                                <i className="fa-sharp fa-solid fa-triangle-exclamation"/>
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
class LoadingSpinner extends React.Component<{}, {}> {
    render() {
        return (
            <div className="loading-spinner"><div></div><div></div><div></div><div></div></div>
        );
    }
}

@mobxReact.observer
class AlertModal extends React.Component<{}, {}> {
    @boundMethod
    closeModal() : void {
        GlobalModel.cancelAlert();
    }

    @boundMethod
    handleOK() : void {
        GlobalModel.confirmAlert();
    }
    
    render() {
        let message = GlobalModel.alertMessage.get();
        if (message == null) {
            return null;
        }
        let title = message.title ?? "Alert";
        let isConfirm = message.confirm;
        return (
            <div className="modal is-active alert-modal">
                <div className="modal-background"/>
                <div className="modal-card">
                    <header className="modal-card-head has-background-danger-light">
                        <p className="modal-card-title"><i className="fa-sharp fa-solid fa-triangle-exclamation"/> {title}</p>
                        <button onClick={this.closeModal} className="delete"></button>
                    </header>
                    <section className="modal-card-body">
                        <p>{message.message}</p>
                    </section>
                    <footer className="modal-card-foot">
                        <If condition={isConfirm}>
                            <button onClick={this.handleOK} className="button is-primary is-outlined">OK</button>
                            <button onClick={this.closeModal} className="button is-danger is-outlined">Cancel</button>
                        </If>
                        <If condition={!isConfirm}>
                            <button onClick={this.handleOK} className="button is-primary">OK</button>
                        </If>
                    </footer>
                </div>
                <button onClick={this.closeModal} className="modal-close" aria-label="close"></button>
            </div>
        );
    }
}

@mobxReact.observer
class WelcomeModal extends React.Component<{}, {}> {
    totalPages : number = 3;
    pageNum : OV<number> = mobx.observable.box(1, {name: "welcome-pagenum"});
    
    @boundMethod
    closeModal() : void {
        mobx.action(() => {
            GlobalModel.welcomeModalOpen.set(false);
        })();
    }

    @boundMethod
    goNext() : void {
        mobx.action(() => {
            this.pageNum.set(this.pageNum.get() + 1);
        })();
    }

    @boundMethod
    goPrev() : void {
        mobx.action(() => {
            this.pageNum.set(this.pageNum.get() - 1);
        })();
    }

    renderDot(num : number) : any {
        if (num == this.pageNum.get()) {
            return <i key={String(num)} className="fa-sharp fa-solid fa-circle"/>;
        }
        return <i key={String(num)} className="fa-sharp fa-regular fa-circle"/>;
    }

    renderDots() : any {
        let elems : any = [];
        for (let i=1; i<=this.totalPages; i++) {
            let elem = this.renderDot(i);
            elems.push(elem);
        }
        return elems;
    }

    render() {
        let title = "welcome to [prompt]";
        let pageNum = this.pageNum.get();
        return (
            <div className={cn("modal welcome-modal is-active")}>
                <div className="modal-background"/>
                <div className="modal-content">
                    <header>
                        <div className="modal-title">welcome to [prompt]</div>
                        <div className="close-icon">
                            <i onClick={this.closeModal} className="fa-sharp fa-solid fa-times"/>
                        </div>
                    </header>
                    <div className={cn("welcome-content content", {"is-hidden": pageNum != 1})}>
                        <p>
                            Prompt is a new terminal to help save you time and keep your command-line life organized.
                            Here's a couple quick tips to get your started!
                        </p>
                    </div>
                    <footer>
                        <If condition={pageNum > 1}>
                            <button className={cn("button is-dark prev-button is-small")} onClick={this.goPrev}>
                                <span className="icon is-small">
                                    <i className="fa-sharp fa-regular fa-angle-left"/>
                                </span>
                                <span>Prev</span>
                            </button>
                        </If>
                        <If condition={pageNum == 1}>
                            <div className="prev-spacer"/>
                        </If>
                        <div className="flex-spacer"/>
                        <div className="dots">
                            {this.renderDots()}
                        </div>
                        <div className="flex-spacer"/>
                        <If condition={pageNum < this.totalPages}>
                            <button className="button is-dark next-button is-small" onClick={this.goNext}>
                                <span>Next</span>
                                <span className="icon is-small">
                                    <i className="fa-sharp fa-regular fa-angle-right"/>
                                </span>
                            </button>
                        </If>
                        <If condition={pageNum == this.totalPages}>
                            <button className="button is-dark next-button is-small" onClick={this.closeModal}>
                                <span>Done</span>
                            </button>
                        </If>
                    </footer>
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

    @boundMethod
    handleContextMenu(e : any) {
        let isInNonTermInput = false;
        let activeElem = document.activeElement;
        if (activeElem != null && activeElem.nodeName == "TEXTAREA") {
            if (!activeElem.classList.contains("xterm-helper-textarea")) {
                isInNonTermInput = true;
            }
        }
        if (activeElem != null && activeElem.nodeName == "INPUT" && activeElem.getAttribute("type") == "text") {
            isInNonTermInput = true;
        }
        let opts : ContextMenuOpts = {};
        if (isInNonTermInput) {
            opts.showCut = true;
        }
        let sel = window.getSelection();
        if (!isBlank(sel.toString())) {
            GlobalModel.contextEditMenu(e, opts);
        }
        else {
            if (isInNonTermInput) {
                GlobalModel.contextEditMenu(e, opts);
            }
        }
    }

    render() {
        return (
            <div id="main" onContextMenu={this.handleContextMenu}>
                <div className="main-content">
                    <MainSideBar/>
                    <SessionView/>
                    <HistoryView/>
                    <BookmarksView/>
                </div>
                <If condition={!GlobalModel.ws.open.get() || !GlobalModel.localServerRunning.get()}>
                    <DisconnectedModal/>
                </If>
                <AlertModal/>
                <If condition={GlobalModel.welcomeModalOpen.get()}>
                    <WelcomeModal/>
                </If>
            </div>
        );
    }
}

export {Main};

