// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import * as util from "@/util/util";
import { If } from "tsx-control-statements/components";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner, Screen } from "@/models";
import { getMonoFontSize } from "@/util/textmeasure";
import * as appconst from "@/app/appconst";

type OV<T> = mobx.IObservableValue<T>;

function pageSize(div: any): number {
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

function scrollDiv(div: any, amt: number) {
    if (div == null) {
        return;
    }
    let newScrollTop = div.scrollTop + amt;
    if (newScrollTop < 0) {
        newScrollTop = 0;
    }
    div.scrollTo({ top: newScrollTop, behavior: "smooth" });
}

class HistoryKeybindings extends React.PureComponent<{ inputObject: TextAreaInput }, {}> {
    componentDidMount(): void {
        if (GlobalModel.activeMainView != "session") {
            return;
        }
        let inputModel = GlobalModel.inputModel;
        let keybindManager = GlobalModel.keybindManager;
        keybindManager.registerKeybinding("pane", "history", "generic:cancel", (waveEvent) => {
            inputModel.resetHistory();
            return true;
        });
        keybindManager.registerKeybinding("pane", "history", "generic:confirm", (waveEvent) => {
            inputModel.grabSelectedHistoryItem();
            return true;
        });
        keybindManager.registerKeybinding("pane", "history", "history:closeHistory", (waveEvent) => {
            inputModel.resetInput();
            return true;
        });
        keybindManager.registerKeybinding("pane", "history", "history:toggleShowRemotes", (waveEvent) => {
            inputModel.toggleRemoteType();
            return true;
        });
        keybindManager.registerKeybinding("pane", "history", "history:changeScope", (waveEvent) => {
            inputModel.toggleHistoryType();
            return true;
        });
        keybindManager.registerKeybinding("pane", "history", "generic:selectAbove", (waveEvent) => {
            inputModel.moveHistorySelection(1);
            return true;
        });
        keybindManager.registerKeybinding("pane", "history", "generic:selectBelow", (waveEvent) => {
            inputModel.moveHistorySelection(-1);
            return true;
        });
        keybindManager.registerKeybinding("pane", "history", "generic:selectPageAbove", (waveEvent) => {
            inputModel.moveHistorySelection(10);
            return true;
        });
        keybindManager.registerKeybinding("pane", "history", "generic:selectPageBelow", (waveEvent) => {
            inputModel.moveHistorySelection(-10);
            return true;
        });
        keybindManager.registerKeybinding("pane", "history", "history:selectPreviousItem", (waveEvent) => {
            inputModel.moveHistorySelection(1);
            return true;
        });
        keybindManager.registerKeybinding("pane", "history", "history:selectNextItem", (waveEvent) => {
            inputModel.moveHistorySelection(-1);
            return true;
        });
    }

    componentWillUnmount(): void {
        GlobalModel.keybindManager.unregisterDomain("history");
    }

    render() {
        return null;
    }
}

class CmdInputKeybindings extends React.PureComponent<{ inputObject: TextAreaInput }, {}> {
    lastTab: boolean;
    curPress: string;

    componentDidMount() {
        if (GlobalModel.activeMainView != "session") {
            return;
        }
        let inputObject = this.props.inputObject;
        this.lastTab = false;
        let keybindManager = GlobalModel.keybindManager;
        let inputModel = GlobalModel.inputModel;
        keybindManager.registerKeybinding("pane", "cmdinput", "cmdinput:autocomplete", (waveEvent) => {
            let lastTab = this.lastTab;
            this.lastTab = true;
            this.curPress = "tab";
            let curLine = inputModel.getCurLine();
            if (lastTab) {
                GlobalModel.submitCommand(
                    "_compgen",
                    null,
                    [curLine],
                    { comppos: String(curLine.length), compshow: "1", nohist: "1" },
                    true
                );
            } else {
                GlobalModel.submitCommand(
                    "_compgen",
                    null,
                    [curLine],
                    { comppos: String(curLine.length), nohist: "1" },
                    true
                );
            }
            return true;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "generic:confirm", (waveEvent) => {
            GlobalModel.closeTabSettings();
            if (GlobalModel.inputModel.isEmpty()) {
                let activeWindow = GlobalModel.getScreenLinesForActiveScreen();
                let activeScreen = GlobalModel.getActiveScreen();
                if (activeScreen != null && activeWindow != null && activeWindow.lines.length > 0) {
                    activeScreen.setSelectedLine(0);
                    GlobalCommandRunner.screenSelectLine("E");
                }
            } else {
                setTimeout(() => GlobalModel.inputModel.uiSubmitCommand(), 0);
            }
            return true;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "generic:cancel", (waveEvent) => {
            GlobalModel.closeTabSettings();
            inputModel.toggleInfoMsg();
            if (inputModel.inputMode.get() != null) {
                inputModel.resetInputMode();
            }
            inputModel.closeAIAssistantChat(true);
            return true;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "cmdinput:expandInput", (waveEvent) => {
            inputModel.toggleExpandInput();
            return true;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "cmdinput:clearInput", (waveEvent) => {
            inputModel.resetInput();
            return true;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "cmdinput:cutLineLeftOfCursor", (waveEvent) => {
            inputObject.controlU();
            return true;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "cmdinput:cutWordLeftOfCursor", (waveEvent) => {
            inputObject.controlW();
            return true;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "cmdinput:paste", (waveEvent) => {
            inputObject.controlY();
            return true;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "cmdinput:openHistory", (waveEvent) => {
            inputModel.openHistory();
            return true;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "cmdinput:previousHistoryItem", (waveEvent) => {
            this.curPress = "historyupdown";
            inputObject.controlP();
            return true;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "cmdinput:nextHistoryItem", (waveEvent) => {
            this.curPress = "historyupdown";
            inputObject.controlN();
            return true;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "cmdinput:openAIChat", (waveEvent) => {
            inputModel.openAIAssistantChat();
            return true;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "generic:selectAbove", (waveEvent) => {
            this.curPress = "historyupdown";
            let rtn = inputObject.arrowUpPressed();
            return rtn;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "generic:selectBelow", (waveEvent) => {
            this.curPress = "historyupdown";
            let rtn = inputObject.arrowDownPressed();
            return rtn;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "generic:selectPageAbove", (waveEvent) => {
            this.curPress = "historyupdown";
            inputObject.scrollPage(true);
            return true;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "generic:selectPageBelow", (waveEvent) => {
            this.curPress = "historyupdown";
            inputObject.scrollPage(false);
            return true;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "generic:expandTextInput", (waveEvent) => {
            inputObject.modEnter();
            return true;
        });
        keybindManager.registerDomainCallback("cmdinput", (waveEvent) => {
            if (this.curPress != "tab") {
                this.lastTab = false;
            }
            if (this.curPress != "historyupdown") {
                inputObject.lastHistoryUpDown = false;
            }
            this.curPress = "";
            return false;
        });
    }

    componentWillUnmount() {
        GlobalModel.keybindManager.unregisterDomain("cmdinput");
    }

    render() {
        return null;
    }
}

@mobxReact.observer
class TextAreaInput extends React.PureComponent<{ screen: Screen; onHeightChange: () => void }, {}> {
    lastTab: boolean = false;
    lastHistoryUpDown: boolean = false;
    lastTabCurLine: OV<string> = mobx.observable.box(null);
    lastFocusType: string = null;
    mainInputRef: React.RefObject<HTMLTextAreaElement> = React.createRef();
    historyInputRef: React.RefObject<HTMLInputElement> = React.createRef();
    controlRef: React.RefObject<HTMLDivElement> = React.createRef();
    lastHeight: number = 0;
    lastSP: StrWithPos = { str: "", pos: appconst.NoStrPos };
    version: OV<number> = mobx.observable.box(0); // forces render updates
    mainInputFocused: OV<boolean> = mobx.observable.box(true);
    historyFocused: OV<boolean> = mobx.observable.box(false);

    incVersion(): void {
        let v = this.version.get();
        mobx.action(() => this.version.set(v + 1))();
    }

    getCurSP(): StrWithPos {
        let textarea = this.mainInputRef.current;
        if (textarea == null) {
            return this.lastSP;
        }
        let str = textarea.value;
        let pos = textarea.selectionStart;
        let endPos = textarea.selectionEnd;
        if (pos != endPos) {
            return { str, pos: appconst.NoStrPos };
        }
        return { str, pos };
    }

    updateSP(): void {
        let curSP = this.getCurSP();
        if (curSP.str == this.lastSP.str && curSP.pos == this.lastSP.pos) {
            return;
        }
        this.lastSP = curSP;
        GlobalModel.sendCmdInputText(this.props.screen.screenId, curSP);
    }

    setFocus(): void {
        let inputModel = GlobalModel.inputModel;
        if (inputModel.historyShow.get()) {
            this.historyInputRef.current.focus();
        } else {
            this.mainInputRef.current.focus();
        }
    }

    getTextAreaMaxCols(): number {
        let taElem = this.mainInputRef.current;
        if (taElem == null) {
            return 0;
        }
        let cs = window.getComputedStyle(taElem);
        let padding = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        let borders = parseFloat(cs.borderLeft) + parseFloat(cs.borderRight);
        let contentWidth = taElem.clientWidth - padding - borders;
        let fontSize = getMonoFontSize(parseInt(cs.fontSize));
        let maxCols = Math.floor(contentWidth / Math.ceil(fontSize.width));
        return maxCols;
    }

    checkHeight(shouldFire: boolean): void {
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
        this.updateSP();
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
        let fcpos = inputModel.forceCursorPos.get();
        if (fcpos != null && fcpos != appconst.NoStrPos) {
            if (this.mainInputRef.current != null) {
                this.mainInputRef.current.selectionStart = fcpos;
                this.mainInputRef.current.selectionEnd = fcpos;
            }
            mobx.action(() => inputModel.forceCursorPos.set(null))();
        }
        if (inputModel.forceInputFocus) {
            inputModel.forceInputFocus = false;
            this.setFocus();
        }
        this.checkHeight(true);
        this.updateSP();
    }

    getLinePos(elem: any): { numLines: number; linePos: number } {
        let numLines = elem.value.split("\n").length;
        let linePos = elem.value.substr(0, elem.selectionStart).split("\n").length;
        return { numLines, linePos };
    }

    arrowUpPressed(): boolean {
        let inputModel = GlobalModel.inputModel;
        if (!inputModel.isHistoryLoaded()) {
            this.lastHistoryUpDown = true;
            inputModel.loadHistory(false, 1, "screen");
            return true;
        }
        let currentRef = this.mainInputRef.current;
        if (currentRef == null) {
            return true;
        }
        let linePos = this.getLinePos(currentRef);
        let lastHist = this.lastHistoryUpDown;
        if (!lastHist && linePos.linePos > 1) {
            // regular arrow
            return false;
        }
        inputModel.moveHistorySelection(1);
        this.lastHistoryUpDown = true;
        return true;
    }

    arrowDownPressed(): boolean {
        let inputModel = GlobalModel.inputModel;
        if (!inputModel.isHistoryLoaded()) {
            return true;
        }
        let currentRef = this.mainInputRef.current;
        if (currentRef == null) {
            return true;
        }
        let linePos = this.getLinePos(currentRef);
        let lastHist = this.lastHistoryUpDown;
        if (!lastHist && linePos.linePos < linePos.numLines) {
            // regular arrow
            return false;
        }
        inputModel.moveHistorySelection(-1);
        this.lastHistoryUpDown = true;
        return true;
    }

    scrollPage(up: boolean) {
        let inputModel = GlobalModel.inputModel;
        let infoScroll = inputModel.hasScrollingInfoMsg();
        if (infoScroll) {
            let div = document.querySelector(".cmd-input-info");
            let amt = pageSize(div);
            scrollDiv(div, up ? -amt : amt);
        }
    }

    modEnter() {
        let currentRef = this.mainInputRef.current;
        if (currentRef == null) {
            return;
        }
        currentRef.setRangeText("\n", currentRef.selectionStart, currentRef.selectionEnd, "end");
        GlobalModel.inputModel.setCurLine(currentRef.value);
    }

    @mobx.action
    @boundMethod
    onKeyDown(e: any) {}

    @boundMethod
    onChange(e: any) {
        mobx.action(() => {
            GlobalModel.inputModel.setCurLine(e.target.value);
        })();
    }

    @boundMethod
    onSelect(e: any) {
        this.incVersion();
    }

    @boundMethod
    onHistoryKeyDown(e: any) {}

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
        let cmdLineUpdate = { str: restValue, pos: 0 };
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
        let cutSpot = selStart - 1;
        let initial = true;
        for (; cutSpot >= 0; cutSpot--) {
            let ch = value[cutSpot];
            if (ch == " " && initial) {
                continue;
            }
            initial = false;
            if (ch == " ") {
                cutSpot++;
                break;
            }
        }
        if (cutSpot == -1) {
            cutSpot = 0;
        }
        let cutValue = value.slice(cutSpot, selStart);
        let prevValue = value.slice(0, cutSpot);
        let restValue = value.slice(selStart);
        let cmdLineUpdate = { str: prevValue + restValue, pos: prevValue.length };
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
            let cmdLineUpdate = { str: newValue, pos: selStart + clipText.length };
            GlobalModel.inputModel.updateCmdLine(cmdLineUpdate);
        });
    }

    @boundMethod
    handleHistoryInput(e: any) {
        let inputModel = GlobalModel.inputModel;
        mobx.action(() => {
            let opts = mobx.toJS(inputModel.historyQueryOpts.get());
            opts.queryStr = e.target.value;
            inputModel.setHistoryQueryOpts(opts);
        })();
    }

    @boundMethod
    handleMainFocus(e: any) {
        let inputModel = GlobalModel.inputModel;
        if (inputModel.historyShow.get()) {
            e.preventDefault();
            if (this.historyInputRef.current != null) {
                this.historyInputRef.current.focus();
            }
            return;
        }
        inputModel.setPhysicalInputFocused(true);
        mobx.action(() => {
            this.mainInputFocused.set(true);
        })();
    }

    @boundMethod
    handleMainBlur(e: any) {
        if (document.activeElement == this.mainInputRef.current) {
            return;
        }
        GlobalModel.inputModel.setPhysicalInputFocused(false);
        mobx.action(() => {
            this.mainInputFocused.set(false);
        })();
    }

    @boundMethod
    handleHistoryFocus(e: any) {
        let inputModel = GlobalModel.inputModel;
        if (!inputModel.historyShow.get()) {
            e.preventDefault();
            if (this.mainInputRef.current != null) {
                this.mainInputRef.current.focus();
            }
            return;
        }
        inputModel.setPhysicalInputFocused(true);
        mobx.action(() => {
            this.historyFocused.set(true);
        })();
    }

    @boundMethod
    handleHistoryBlur(e: any) {
        if (document.activeElement == this.historyInputRef.current) {
            return;
        }
        GlobalModel.inputModel.setPhysicalInputFocused(false);
        mobx.action(() => {
            this.historyFocused.set(false);
        })();
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
        let version = this.version.get(); // to force reactions
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
        let termFontSize = GlobalModel.getTermFontSize();
        let fontSize = getMonoFontSize(termFontSize);
        let termPad = fontSize.pad;
        let computedInnerHeight = displayLines * fontSize.height + 2 * termPad;
        let computedOuterHeight = computedInnerHeight + 2 * termPad;
        let shellType: string = "";
        let screen = GlobalModel.getActiveScreen();
        if (screen != null) {
            let ri = screen.getCurRemoteInstance();
            if (ri != null && ri.shelltype != null) {
                shellType = ri.shelltype;
            }
            if (shellType == "") {
                let rptr = screen.curRemote.get();
                if (rptr != null) {
                    let remote = GlobalModel.getRemote(rptr.remoteid);
                    if (remote != null) {
                        shellType = remote.defaultshelltype;
                    }
                }
            }
        }
        let isMainInputFocused = this.mainInputFocused.get();
        let isHistoryFocused = this.historyFocused.get();
        return (
            <div
                className="textareainput-div control is-expanded"
                ref={this.controlRef}
                style={{ height: computedOuterHeight }}
            >
                <If condition={isMainInputFocused}>
                    <CmdInputKeybindings inputObject={this}></CmdInputKeybindings>
                </If>
                <If condition={isHistoryFocused}>
                    <HistoryKeybindings inputObject={this}></HistoryKeybindings>
                </If>

                <If condition={!disabled && !util.isBlank(shellType)}>
                    <div className="shelltag">{shellType}</div>
                </If>
                <textarea
                    key="main"
                    ref={this.mainInputRef}
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    id="main-cmd-input"
                    onFocus={this.handleMainFocus}
                    onBlur={this.handleMainBlur}
                    style={{ height: computedInnerHeight, minHeight: computedInnerHeight, fontSize: termFontSize }}
                    value={curLine}
                    onKeyDown={this.onKeyDown}
                    onChange={this.onChange}
                    onSelect={this.onSelect}
                    className={cn("textarea", { "display-disabled": disabled })}
                ></textarea>
                <input
                    key="history"
                    ref={this.historyInputRef}
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    className="history-input"
                    type="text"
                    onFocus={this.handleHistoryFocus}
                    onBlur={this.handleHistoryBlur}
                    onKeyDown={this.onHistoryKeyDown}
                    onChange={this.handleHistoryInput}
                    value={inputModel.historyQueryOpts.get().queryStr}
                />
            </div>
        );
    }
}

export { TextAreaInput };
