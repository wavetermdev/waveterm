import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames";
import {debounce, throttle} from "throttle-debounce";
import {v4 as uuidv4} from "uuid";
import dayjs from "dayjs";
import type {SessionDataType, LineType, CmdDataType, RemoteType, RemoteStateType, RemoteInstanceType, RemotePtrType, HistoryItem, HistoryQueryOpts, RemoteEditType, ContextMenuOpts, BookmarkType, RenderModeType, LineFactoryProps} from "./types";
import type * as T from "./types";
import localizedFormat from 'dayjs/plugin/localizedFormat';
import {GlobalModel, GlobalCommandRunner, Session, Cmd, ScreenLines, Screen, riToRPtr, TabColors, RemoteColors} from "./model";
import {windowWidthToCols, windowHeightToRows, termHeightFromRows, termWidthFromCols, getMonoFontSize} from "./textmeasure";
import {isModKeyPress, boundInt, sortAndFilterRemotes, makeExternLink, isBlank, hasNoModifiers} from "./util";
import {BookmarksView} from "./bookmarks";
import {WebShareView} from "./webshare-client-view";
import {HistoryView} from "./history";
import {Line, Prompt} from "./linecomps";
import {ScreenSettingsModal, SessionSettingsModal, LineSettingsModal, ClientSettingsModal} from "./settings";
import {RemotesModal} from "./remotes";
import {renderCmdText, RemoteStatusLight, Markdown} from "./elements";
import {LinesView} from "./linesview";
import {TosModal} from "./modals";

dayjs.extend(localizedFormat)

const RemotePtyRows = 8;
const RemotePtyCols = 80;
const PasswordUnchangedSentinel = "--unchanged--";
const LinesVisiblePadding = 500;
const TDots = "⋮";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K,V> = mobx.ObservableMap<K,V>;

type VisType = "visible" | "";

type InterObsValue = {
    sessionid : string,
    lineid : string,
    cmdid : string,
    visible : mobx.IObservableValue<boolean>,
    timeoutid? : any,
};

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

function truncateWithTDots(str : string, maxLen : number) : string {
    if (str == null) {
        return null;
    }
    if (str.length <= maxLen) {
        return str;
    }
    return str.slice(0, maxLen-1) + TDots;
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

    getTextAreaMaxCols() : number {
        let taElem = this.mainInputRef.current;
        if (taElem == null) {
            return 0;
        }
        let cs = window.getComputedStyle(taElem);
        let padding = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        let borders = parseFloat(cs.borderLeft) + parseFloat(cs.borderRight);
        let contentWidth = taElem.clientWidth - padding - borders;
        let fontSize = getMonoFontSize(parseInt(cs.fontSize));
        let maxCols = Math.floor(contentWidth / fontSize.width);
        return maxCols;
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
        if (inputModel.forceInputFocus) {
            inputModel.forceInputFocus = false;
            this.setFocus();
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
            let win = model.getScreenLinesForActiveScreen();
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
                        let activeWindow = GlobalModel.getScreenLinesForActiveScreen();
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
            if (e.code == "KeyE" && e.getModifierState("Meta")) {
                e.preventDefault();
                e.stopPropagation();
                let inputModel = GlobalModel.inputModel;
                inputModel.toggleExpandInput();
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
            if (e.code == "KeyP" && e.getModifierState("Control")) {
                e.preventDefault();
                this.controlP();
                return;
            }
            if (e.code == "KeyN" && e.getModifierState("Control")) {
                e.preventDefault();
                this.controlN();
                return;
            }
            if (e.code == "KeyW" && e.getModifierState("Control")) {
                e.preventDefault();
                this.controlW();
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
            if ((e.code == "ArrowUp" || e.code == "ArrowDown") && hasNoModifiers(e)) {
                if (!inputModel.isHistoryLoaded()) {
                    if (e.code == "ArrowUp") {
                        this.lastHistoryUpDown = true;
                        inputModel.loadHistory(false, 1, "screen");
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
            if (htype == "screen") {
                htype = "session";
            }
            else if (htype == "session") {
                htype = "global";
            }
            else {
                htype = "screen";
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
        if (e.code == "KeyP" && e.getModifierState("Control")) {
            e.preventDefault();
            inputModel.moveHistorySelection(1);
            return;
        }
        if (e.code == "KeyN" && e.getModifierState("Control")) {
            e.preventDefault();
            inputModel.moveHistorySelection(-1);
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
    controlP() {
        let inputModel = GlobalModel.inputModel;
        if (!inputModel.isHistoryLoaded()) {
            this.lastHistoryUpDown = true;
            inputModel.loadHistory(false, 1, "screen");
            return;
        }
        inputModel.moveHistorySelection(1);
        this.lastHistoryUpDown = true;
    }

    @boundMethod
    controlN() {
        let inputModel = GlobalModel.inputModel;
        inputModel.moveHistorySelection(-1);
        this.lastHistoryUpDown = true;
    }

    @boundMethod
    controlW() {
        if (this.mainInputRef.current == null) {
            return;
        }
        let selStart = this.mainInputRef.current.selectionStart;
        let value = this.mainInputRef.current.value;
        if (selStart > value.length) {
            return;
        }
        let cutSpot = selStart-1;
        let initial = true;
        for (;cutSpot>=0; cutSpot--) {
            let ch = value[cutSpot];
            console.log(cutSpot, "[" + ch + "]");
            if (ch == " " && initial) {
                continue;
            }
            initial = false;
            if (ch == " ") {
                cutSpot++;
                break;
            }
        }
        let cutValue = value.slice(cutSpot, selStart);
        let prevValue = value.slice(0, cutSpot);
        let restValue = value.slice(selStart);
        let cmdLineUpdate = {cmdline: prevValue + restValue, cursorpos: prevValue.length};
        console.log("ss", selStart, value, "prev[" + prevValue + "]", "cut[" + cutValue + "]", "rest[" + restValue + "]");
        console.log("  ", cmdLineUpdate);
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
        let displayLines = 1;
        let numLines = curLine.split("\n").length;
        let maxCols = this.getTextAreaMaxCols();
        let longLine = false;
        if (maxCols != 0 && curLine.length >= maxCols - 4) {
            longLine = true;
        }
        if (numLines > 1 || longLine || inputModel.inputExpanded.get()) {
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
        let computedHeight = (displayLines*24)+14+2;  // 24 = height of line, 14 = padding, 2 = border
        return (
            <div className="control cmd-input-control is-expanded" ref={this.controlRef}>
                <textarea key="main" ref={this.mainInputRef} spellCheck="false" autoComplete="off" autoCorrect="off" id="main-cmd-input" onFocus={this.handleMainFocus} onBlur={this.handleMainBlur} style={{height: computedHeight, minHeight: computedHeight}} value={curLine} onKeyDown={this.onKeyDown} onChange={this.onChange} className={cn("textarea", {"display-disabled": disabled})}></textarea>
                <input key="history" ref={this.historyInputRef} spellCheck="false" autoComplete="off" autoCorrect="off" className="history-input" type="text" onFocus={this.handleHistoryFocus} onKeyDown={this.onHistoryKeyDown} onChange={this.handleHistoryInput} value={inputModel.historyQueryOpts.get().queryStr}/>
            </div>
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
        }
        let activeScreen = model.getActiveScreen();
        return (
            <div className="cmd-input-info" style={{display: (infoShow ? "block" : "none")}}>
                <If condition={infoMsg && infoMsg.infotitle != null}>
                    <div key="infotitle" className="info-title">
                        {titleStr}
                    </div>
                </If>
                <If condition={infoMsg && infoMsg.infomsg != null}>
                    <div key="infomsg" className="info-msg">
                        <If condition={infoMsg.infomsghtml}>
                            <span dangerouslySetInnerHTML={{__html: infoMsg.infomsg}}/>
                        </If>
                        <If condition={!infoMsg.infomsghtml}>
                            {infoMsg.infomsg}
                        </If>
                    </div>
                </If>
                <If condition={infoMsg && infoMsg.websharelink && activeScreen != null}>
                    <div key="infomsg" className="info-msg">
                        started sharing screen at <a target="_blank" href={makeExternLink(activeScreen.getWebShareUrl())}>[link]</a>
                    </div>
                </If>
                <If condition={infoMsg && infoMsg.infolines != null}>
                    <div key="infolines" className="info-lines">
                        <For index="idx" each="line" of={infoMsg.infolines}>
                            <div key={idx}>{line == "" ? " " : line}</div>
                        </For>
                    </div>
                </If>
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
        let rtn = sprintf("%-15s ", "[" + truncateWithTDots(rname, 13) + "]")
        return rtn;
    }

    renderHInfoText(hitem : HistoryItem, opts : HistoryQueryOpts, isSelected : boolean, snames : Record<string, string>, scrNames : Record<string, string>) : string {
        let remoteStr = "";
        if (!opts.limitRemote) {
            remoteStr = this.renderRemote(hitem);
        }
        let selectedStr = (isSelected ? "*" : " ");
        let lineNumStr = (hitem.linenum > 0 ? "(" + hitem.linenum + ")" : "");
        if (isBlank(opts.queryType) || opts.queryType == "screen") {
            return selectedStr + sprintf("%7s", lineNumStr) + " " + remoteStr;
        }
        if (opts.queryType == "session") {
            let screenStr = "";
            if (!isBlank(hitem.screenid)) {
                let scrName = scrNames[hitem.screenid];
                if (scrName != null) {
                    screenStr = "[" + truncateWithTDots(scrName, 15) + "]";
                }
            }
            return selectedStr + sprintf("%17s", screenStr) + sprintf("%7s", lineNumStr) + " " + remoteStr;
        }
        if (opts.queryType == "global") {
            let sessionStr = "";
            if (!isBlank(hitem.sessionid)) {
                let sessionName = snames[hitem.sessionid];
                if (sessionName != null) {
                    sessionStr = "#" + truncateWithTDots(sessionName, 15);
                }
            }
            let screenStr = "";
            if (!isBlank(hitem.screenid)) {
                let scrName = scrNames[hitem.screenid];
                if (scrName != null) {
                    screenStr = "[" + truncateWithTDots(scrName, 13) + "]";
                }
            }
            let ssStr = sessionStr + screenStr;
            return selectedStr + sprintf("%15s ", sessionStr) + " " + sprintf("%15s", screenStr) + sprintf("%7s", lineNumStr) + " " + remoteStr;
        }
        return "-";
    }

    renderHItem(hitem : HistoryItem, opts : HistoryQueryOpts, isSelected : boolean, snames : Record<string, string>, scrNames : Record<string, string>) : any {
        let lines = hitem.cmdstr.split("\n");
        let line : string = "";
        let idx = 0;
        let infoText = this.renderHInfoText(hitem, opts, isSelected, snames, scrNames);
        let infoTextSpacer = sprintf("%" + infoText.length + "s", "");
        return (
            <div key={hitem.historynum} className={cn("history-item", {"is-selected": isSelected}, {"history-haderror": hitem.haderror}, "hnum-" + hitem.historynum)} onClick={() => this.handleItemClick(hitem)}>
                <div className="history-line">{infoText} {lines[0]}</div>
                <For each="line" index="idx" of={lines.slice(1)}>
                    <div key={idx} className="history-line">{infoTextSpacer} {line}</div>
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
        let snames : Record<string, string> = {};
        let scrNames : Record<string, string> = {};
        if (opts.queryType == "global") {
            scrNames = GlobalModel.getScreenNames();
            snames = GlobalModel.getSessionNames();
        }
        else if (opts.queryType == "session") {
            scrNames = GlobalModel.getScreenNames();
        }
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
                            {this.renderHItem(hitem, opts, (hitem == selItem), snames, scrNames)}
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
    clickHistoryHint(e : any) : void {
        e.preventDefault();
        e.stopPropagation();
        
        let inputModel = GlobalModel.inputModel;
        if (inputModel.historyShow.get()) {
            inputModel.resetHistory();
        }
        else {
            inputModel.openHistory();
        }
    }

    @boundMethod
    clickConnectRemote(remoteId : string) : void {
        GlobalCommandRunner.connectRemote(remoteId);
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
        let feState : Record<string, string> = null;
        if (ri != null) {
            remote = GlobalModel.getRemote(ri.remoteid);
            feState = ri.festate;
        }
        let infoShow = inputModel.infoShow.get();
        let historyShow = !infoShow && inputModel.historyShow.get();
        let infoMsg = inputModel.infoMsg.get();
        let hasInfo = (infoMsg != null);
        let focusVal = inputModel.physicalInputFocused.get();
        let inputMode : string = inputModel.inputMode.get();
        let textAreaInputKey = (screen == null ? "null" : screen.screenId);
        return (
            <div ref={this.cmdInputRef} className={cn("cmd-input has-background-black", {"has-info": infoShow}, {"has-history": historyShow})}>
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
                <If condition={remote && remote.status != "connected"}>
                    <div className="remote-status-warning">
                        WARNING:&nbsp;<span className="remote-name">[{GlobalModel.resolveRemoteIdToFullRef(remote.remoteid)}]</span>&nbsp;is {remote.status}
                        <If condition={remote.status != "connecting"}><div className="button is-prompt-green is-outlined is-small" onClick={() => this.clickConnectRemote(remote.remoteid)}>connect now</div></If>
                    </div>
                </If>
                <div key="prompt" className="cmd-input-context">
                    <div className="has-text-white">
                        <Prompt rptr={rptr} festate={feState}/>
                    </div>
                </div>
                <div key="input" className={cn("cmd-input-field field has-addons", (inputMode != null ? "inputmode-" + inputMode : null))}>
                    <If condition={inputMode != null}>
                        <div className="control cmd-quick-context">
                            <div className="button is-static">{inputMode}</div>
                        </div>
                    </If>
                    <TextAreaInput key={textAreaInputKey} onHeightChange={this.handleInnerHeightUpdate}/>
                    <div className="control cmd-exec">
                        <div onClick={inputModel.uiSubmitCommand} className="button" title="Run Command">
                            <span className="icon">
                                <i className="fa-sharp fa-solid fa-rocket"/>
                            </span>
                        </div>
                    </div>
                    <div className="cmd-hints">
                        <div onClick={inputModel.toggleExpandInput} className="hint-item color-white">{inputModel.inputExpanded.get() ? "shrink" : "expand"} input ({renderCmdText("E")})</div>
                        <If condition={!focusVal}><div onClick={this.clickFocusInputHint} className="hint-item color-white">focus input ({renderCmdText("I")})</div></If>
                        <If condition={focusVal}><div onMouseDown={this.clickHistoryHint} className="hint-item color-green"><i className={cn("fa-sharp fa-solid", (historyShow ? "fa-angle-down" : "fa-angle-up"))}/> {historyShow ? "close history (esc)" : "show history (ctrl-r)"}</div></If>
                    </div>
                </div>
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
    shareCopied : OV<boolean> = mobx.observable.box(false, {name: "sw-shareCopied"});

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
        if (width == null || height == null || width == 0 || height == 0) {
            return;
        }
        mobx.action(() => {
            this.width.set(width);
            this.height.set(height);
            screen.screenSizeCallback({height: height, width: width});
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
        mobx.action(() => {
            this.setSize_debounced(width, height);
        })();
    }

    getScreenLines() : ScreenLines {
        let {screen} = this.props;
        let win = GlobalModel.getScreenLinesById(screen.screenId);
        if (win == null) {
            win = GlobalModel.loadScreenLines(screen.screenId);
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
            <div className="window-view" style={this.getWindowViewStyle()} ref={this.windowViewRef} data-screenid={screen.screenId}>
                <div key="lines" className="lines"></div>
                <div key="window-empty" className={cn("window-empty", {"should-fade": fade})}>
                    <div>{message}</div>
                </div>
            </div>
        );
    }

    @boundMethod
    copyShareLink() : void {
        let {screen} = this.props;
        let shareLink = screen.getWebShareUrl();
        if (shareLink == null) {
            return;
        }
        navigator.clipboard.writeText(shareLink);
        mobx.action(() => {
            this.shareCopied.set(true);
        })();
        setTimeout(() => {
            mobx.action(() => {
                this.shareCopied.set(false);
            })();
        }, 600)
    }

    @boundMethod
    openScreenSettings() : void {
        let {screen} = this.props;
        mobx.action(() => {
            GlobalModel.screenSettingsModal.set({sessionId: screen.sessionId, screenId: screen.screenId});
        })();
    }

    @boundMethod
    buildLineComponent(lineProps : LineFactoryProps) : JSX.Element {
        let {screen} = this.props;
        let {line, ...restProps} = lineProps;
        let realLine : LineType = (line as LineType);
        return (
            <Line key={realLine.lineid} screen={screen} line={realLine} {...restProps}/>
        );
    }

    render() {
        let {screen} = this.props;
        let win = this.getScreenLines();
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
                <div key="rendermode-tag" className={cn("rendermode-tag", {"is-active": isActive})} style={{display: "none"}}>
                    <div className="render-mode" onClick={this.toggleRenderMode}>
                        <If condition={renderMode == "normal"}>
                            <i title="collapse" className="fa-sharp fa-solid fa-arrows-to-line"/>
                        </If>
                        <If condition={renderMode == "collapsed"}>
                            <i title="expand" className="fa-sharp fa-solid fa-arrows-from-line"/>
                        </If>
                    </div>
                </div>
                <If condition={screen.isWebShared()}>
                    <div key="share-tag" className="share-tag">
                        <If condition={this.shareCopied.get()}>
                            <div className="copied-indicator"/>
                        </If>
                        <div className="share-tag-title"><i title="archived" className="fa-sharp fa-solid fa-share-nodes"/> web shared</div>
                        <div className="share-tag-link">
                            <div className="button is-prompt-green is-outlined is-small" onClick={this.copyShareLink}>
                                <span>copy link</span>
                                <span className="icon">
                                    <i className="fa-sharp fa-solid fa-copy"/>
                                </span>
                            </div>
                            <div className="button is-prompt-green is-outlined is-small" onClick={this.openScreenSettings}>
                                <span>open settings</span>
                                <span className="icon">
                                    <i className="fa-sharp fa-solid fa-cog"/>
                                </span>
                            </div>
                        </div>
                    </div>
                </If>
                <If condition={lines.length > 0}>
                    <LinesView screen={screen} width={this.width.get()} lines={lines} renderMode={renderMode} lineFactory={this.buildLineComponent}/>
                </If>
                <If condition={lines.length == 0}>
                    <div key="window-empty" className="window-empty">
                        <div><code>[session="{session.name.get()}" screen="{screen.name.get()}"]</code></div>
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
                <ScreenWindowView key={screen.screenId + ":" + fontSize} screen={screen}/>
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

    @boundMethod
    openScreenSettings(e : any, screen : Screen) : void {
        e.preventDefault();
        e.stopPropagation();
        mobx.action(() => {
            GlobalModel.screenSettingsModal.set({sessionId: screen.sessionId, screenId: screen.screenId});
        })();
    }

    renderTab(screen : Screen, activeScreenId : string, index : number) : any {
        let tabIndex = null;
        if (index+1 <= 9) {
            tabIndex = (<div className="tab-index">{renderCmdText(String(index+1))}</div>);
        }
        let settings = (<div onClick={(e) => this.openScreenSettings(e, screen)} title="Settings" className="tab-gear"><i className="fa-sharp fa-solid fa-gear"/></div>);
        let archived = (screen.archived.get() ? (<i title="archived" className="fa-sharp fa-solid fa-box-archive"/>) : null);

        let webShared = (screen.isWebShared() ? (<i title="shared to web" className="fa-sharp fa-solid fa-share-nodes web-share-icon"/>) : null);
        return (
            <div key={screen.screenId} data-screenid={screen.screenId} className={cn("screen-tab", {"is-active": activeScreenId == screen.screenId, "is-archived": screen.archived.get()}, "color-" + screen.getTabColor())} onClick={() => this.handleSwitchScreen(screen.screenId)} onContextMenu={(event) => this.openScreenSettings(event, screen)}>
                <div className="tab-name">
                    {archived}
                    {webShared}
                    {screen.name.get()}
                </div>
                {tabIndex}
                {settings}
            </div>
        );
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
        showingScreens.sort((a, b) => {
            let aidx = a.screenIdx.get();
            let bidx = b.screenIdx.get();
            if (aidx < bidx) {
                return -1;
            }
            if (aidx > bidx) {
                return 1;
            }
            return 0;
        });
        return (
            <div className="screen-tabs-container">
                <div className={cn("screen-tabs", {"scrolling": this.scrolling.get()})} ref={this.tabsRef} onScroll={this.handleScroll}>
                    <For each="screen" index="index" of={showingScreens}>
                        {this.renderTab(screen, activeScreenId, index)}
                    </For>
                    <div key="new-screen" className="screen-tab new-screen" onClick={this.handleNewScreen}>
                        <i className="fa-sharp fa-solid fa-plus"/>
                    </div>
                    
                </div>
                <div className="cmd-hints">
                    <div className="hint-item color-green">move left {renderCmdText("[")}</div>
                    <div className="hint-item color-green">move right {renderCmdText("]")}</div>
                    <div className="hint-item color-green">new tab {renderCmdText("T")}</div>
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

    clickLinks() {
        mobx.action(() => {
            GlobalModel.showLinks.set(!GlobalModel.showLinks.get());
        })();
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
            GlobalModel.showSessionView();
            return;
        }
        GlobalCommandRunner.bookmarksView();
    }

    @boundMethod
    handleWebSharingClick() : void {
        if (GlobalModel.activeMainView.get() == "webshare") {
            GlobalModel.showSessionView();
            return;
        }
        GlobalModel.showWebShareView();
    }

    @boundMethod
    handleWelcomeClick() : void {
        mobx.action(() => {
            GlobalModel.welcomeModalOpen.set(true);
        })();
    }

    @boundMethod
    handleSettingsClick() : void {
        mobx.action(() => {
            GlobalModel.clientSettingsModal.set(true);
        })();
    }

    @boundMethod
    handleConnectionsClick() : void {
        GlobalModel.remotesModalModel.openModal();
    }

    @boundMethod
    openSessionSettings(e : any, session : Session) : void {
        e.preventDefault();
        e.stopPropagation();
        mobx.action(() => {
            GlobalModel.sessionSettingsModal.set(session.sessionId);
        })();
    }

    render() {
        let model = GlobalModel;
        let activeSessionId = model.activeSessionId.get();
        let activeWindow = model.getScreenLinesForActiveScreen();
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
                <div className="logo-header">
                    <h1 className={cn("title", "prompt-logo-small", {"collapsed": isCollapsed}, {"is-dev": GlobalModel.isDev})}>
                        {(isCollapsed ? "[p]" : "[prompt]")}
                    </h1>
                </div>
                <div className="collapse-container">
                    <div className="arrow-container" onClick={this.toggleCollapsed}>
                        <If condition={!isCollapsed}><i className="fa-sharp fa-solid fa-angle-left"/></If>
                        <If condition={isCollapsed}><i className="fa-sharp fa-solid fa-angle-right"/></If>
                    </div>
                </div>
                <div className="menu">
                    <p className="menu-label">
                        Sessions
                    </p>
                    <ul className="menu-list session-menu-list">
                        <If condition={!model.sessionListLoaded.get()}>
                            <li className="menu-loading-message"><a>...</a></li>
                        </If>
                        <If condition={model.sessionListLoaded.get()}>
                            <For each="session" index="idx" of={sessionList}>
                                <li key={session.sessionId}><a className={cn({"is-active": mainView == "session" && activeSessionId == session.sessionId})} onClick={() => this.handleSessionClick(session.sessionId)}>
                                    <If condition={!session.archived.get()}>
                                        <div className="session-num"><span className="hotkey">^⌘</span>{idx+1}</div>
                                    </If>
                                    <If condition={session.archived.get()}>
                                        <div className="session-num"><i title="archived" className="fa-sharp fa-solid fa-box-archive"/></div>
                                    </If>
                                    <div>
                                        {session.name.get()}
                                    </div>
                                    <div className="flex-spacer"/>
                                    <div className="session-gear" onClick={(e) => this.openSessionSettings(e, session)}>
                                        <i className="fa-sharp fa-solid fa-gear"/>
                                    </div>
                                </a></li>
                            </For>
                            <li className="new-session"><a onClick={() => this.handleNewSession()}><i className="fa-sharp fa-solid fa-plus"/> New Session</a></li>
                        </If>
                    </ul>
                    <ul className="menu-list" style={{marginTop: 20}}>
                        <li className="menu-history"><a onClick={this.handleHistoryClick} className={cn({"is-active": (mainView == "history")})}><i className="fa-sharp fa-solid fa-clock"/> HISTORY <span className="hotkey">&#x2318;H</span></a></li>
                    </ul>
                    <ul className="menu-list">
                        <li className="menu-bookmarks"><a onClick={this.handleBookmarksClick} className={cn({"is-active": (mainView == "bookmarks")})}><i className="fa-sharp fa-solid fa-bookmark"/> BOOKMARKS <span className="hotkey">&#x2318;B</span></a></li>
                    </ul>
                    <ul className="menu-list">
                        <li className="menu-websharing"><a onClick={this.handleWebSharingClick} className={cn({"is-active": (mainView == "webshare")})}><i className="fa-sharp fa-solid fa-share-nodes"/> WEB SHARING</a></li>
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
                    <ul className="menu-list" style={{display: "none"}}>
                        <li className="menu-bookmarks"><a onClick={this.handleWelcomeClick} className={cn({"is-active": GlobalModel.welcomeModalOpen.get()})}><i className="fa-sharp fa-solid fa-door-open"/> WELCOME</a></li>
                    </ul>
                    <ul className="menu-list">
                        <li className="menu-settings"><a onClick={this.handleSettingsClick}><i className="fa-sharp fa-solid fa-cog"/> SETTINGS</a></li>
                    </ul>
                    <p className="menu-label">
                        <a onClick={() => this.clickLinks()}>LINKS <i className={cn("fa-sharp fa-solid", (GlobalModel.showLinks.get() ? "fa-angle-down" : "fa-angle-right"))}/></a>
                    </p>
                    <ul className="menu-list" style={{display: (GlobalModel.showLinks.get() ? null : "none")}}>
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
                        <a onClick={this.handleConnectionsClick}>Connections</a>
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
            <div className="prompt-modal disconnected-modal modal is-active">
                <div className="modal-background"></div>
                <div className="modal-content">
                    <div className="message-header">
                        <div className="modal-title">Prompt Client Disconnected</div>
                    </div>
                    <If condition={this.showLog.get()}>
                        <div className="inner-content">
                            <div className="ws-log" ref={this.logRef}>
                                <For each="logLine" index="idx" of={GlobalModel.ws.wsLog}>
                                    <div key={idx} className="ws-logline">{logLine}</div>
                                </For>
                            </div>
                        </div>
                    </If>
                    <footer>
                        <div className="footer-text-link" style={{marginLeft: 10}} onClick={this.handleShowLog}>
                            <If condition={!this.showLog.get()}>
                                <i className="fa-sharp fa-solid fa-plus"/> Show Log
                            </If>
                            <If condition={this.showLog.get()}>
                                <i className="fa-sharp fa-solid fa-minus"/> Hide Log
                            </If>
                        </div>
                        <div className="flex-spacer"/>
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
                    </footer>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class ClientStopModal extends React.Component<{}, {}> {
    @boundMethod
    refreshClient() {
        GlobalModel.refreshClient();
    }

    render() {
        let model = GlobalModel;
        let cdata = model.clientData.get();
        let title = "Client Not Ready";
        return (
            <div className="prompt-modal client-stop-modal modal is-active">
                <div className="modal-background"></div>
                <div className="modal-content">
                    <div className="message-header">
                        <div className="modal-title">[prompt] {title}</div>
                    </div>
                    <div className="inner-content">
                        <If condition={cdata == null}>
                            <div>Cannot get client data.</div>
                        </If>
                    </div>
                    <footer>
                        <button onClick={this.refreshClient} className="button">
                            <span className="icon">
                                <i className="fa-sharp fa-solid fa-rotate"/>
                            </span>
                            <span>Hard Refresh Client</span>
                        </button>
                    </footer>
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
        let title = message.title ?? (message.confirm ? "Confirm" : "Alert");
        let isConfirm = message.confirm;
        return (
            <div className="modal prompt-modal is-active alert-modal">
                <div className="modal-background"/>
                <div className="modal-content">
                    <header>
                        <p className="modal-title"><i className="fa-sharp fa-solid fa-triangle-exclamation"/> {title}</p>
                        <div className="close-icon">
                            <i onClick={this.closeModal} className="fa-sharp fa-solid fa-times"/>
                        </div>
                    </header>
                    <If condition={message.markdown}>
                        <Markdown text={message.message} extraClassName="inner-content"/>
                    </If>
                    <If condition={!message.markdown}>
                        <div className="inner-content content">
                            <p>{message.message}</p>
                        </div>
                    </If>
                    <footer>
                        <If condition={isConfirm}>
                            <div onClick={this.closeModal} className="button is-prompt-cancel is-outlined is-small">Cancel</div>
                            <div onClick={this.handleOK} className="button is-prompt-green is-outlined is-small">OK</div>
                        </If>
                        <If condition={!isConfirm}>
                            <div onClick={this.handleOK} className="button is-prompt-green is-small">OK</div>
                        </If>
                    </footer>
                </div>
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
        let pageNum = this.pageNum.get();
        return (
            <div className={cn("modal welcome-modal prompt-modal is-active")}>
                <div className="modal-background"/>
                <div className="modal-content">
                    <header>
                        <div className="modal-title">welcome to [prompt]</div>
                        <div className="close-icon">
                            <i onClick={this.closeModal} className="fa-sharp fa-solid fa-times"/>
                        </div>
                    </header>
                    <div className={cn("inner-content content", {"is-hidden": pageNum != 1})}>
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
    dcWait : OV<boolean> = mobx.observable.box(false, {name: "dcWait"});
    
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

    @boundMethod
    updateDcWait(val : boolean) : void {
        mobx.action(() => {
            this.dcWait.set(val);
        })();
    }

    render() {
        let screenSettingsModal = GlobalModel.screenSettingsModal.get();
        let sessionSettingsModal = GlobalModel.sessionSettingsModal.get();
        let lineSettingsModal = GlobalModel.lineSettingsModal.get();
        let clientSettingsModal = GlobalModel.clientSettingsModal.get();
        let remotesModal = GlobalModel.remotesModalModel.isOpen();
        let disconnected = !GlobalModel.ws.open.get() || !GlobalModel.localServerRunning.get();
        let hasClientStop = GlobalModel.getHasClientStop();
        let dcWait = this.dcWait.get();
        if (disconnected || hasClientStop) {
            if (!dcWait) {
                setTimeout(() => this.updateDcWait(true), 1500);
            }
            return (
                <div id="main" onContextMenu={this.handleContextMenu}>
                    <div className="main-content">
                        <MainSideBar/>
                        <div className="session-view"/>
                    </div>
                    <If condition={dcWait}>
                        <If condition={disconnected}>
                            <DisconnectedModal/>
                        </If>
                        <If condition={!disconnected && hasClientStop}>
                            <ClientStopModal/>
                        </If>
                    </If>
                </div>
            );
        }
        if (dcWait) {
            setTimeout(() => this.updateDcWait(false), 0);
        }
        return (
            <div id="main" onContextMenu={this.handleContextMenu}>
                <div className="main-content">
                    <MainSideBar/>
                    <SessionView/>
                    <HistoryView/>
                    <BookmarksView/>
                    <WebShareView/>
                </div>
                <AlertModal/>
                <If condition={GlobalModel.needsTos()}>
                    <TosModal/>
                </If>
                <If condition={GlobalModel.welcomeModalOpen.get()}>
                    <WelcomeModal/>
                </If>
                <If condition={screenSettingsModal != null}>
                    <ScreenSettingsModal key={screenSettingsModal.sessionId + ":" + screenSettingsModal.screenId} sessionId={screenSettingsModal.sessionId} screenId={screenSettingsModal.screenId}/>
                </If>
                <If condition={sessionSettingsModal != null}>
                    <SessionSettingsModal key={sessionSettingsModal} sessionId={sessionSettingsModal}/>
                </If>
                <If condition={lineSettingsModal != null}>
                    <LineSettingsModal key={String(lineSettingsModal)} linenum={lineSettingsModal}/>
                </If>
                <If condition={clientSettingsModal}>
                    <ClientSettingsModal/>
                </If>
                <If condition={remotesModal}>
                    <RemotesModal model={GlobalModel.remotesModalModel}/>
                </If>
            </div>
        );
    }
}

export {Main};

