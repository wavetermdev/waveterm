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
const MaxInputLength = 10 * 1024;

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

class HistoryKeybindings extends React.Component<{}, {}> {
    componentDidMount(): void {
        if (GlobalModel.activeMainView != "session") {
            return;
        }
        const inputModel = GlobalModel.inputModel;
        const keybindManager = GlobalModel.keybindManager;
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

class CmdInputKeybindings extends React.Component<{ inputObject: TextAreaInput }, {}> {
    curPress: string;
    lastTab: boolean;

    componentDidMount() {
        if (GlobalModel.activeMainView != "session") {
            return;
        }
        const inputObject = this.props.inputObject;
        const keybindManager = GlobalModel.keybindManager;
        const inputModel = GlobalModel.inputModel;
        keybindManager.registerKeybinding("pane", "cmdinput", "cmdinput:autocomplete", (waveEvent) => {
            this.curPress = "tab";
            // For now, we want to preserve the old behavior if autocomplete is disabled
            if (GlobalModel.autocompleteModel.isEnabled()) {
                if (this.lastTab) {
                    const curLine = inputModel.curLine;
                    if (curLine != "") {
                        inputModel.setActiveAuxView(appconst.InputAuxView_Suggestions);
                    }
                } else {
                    this.lastTab = true;
                }
            } else {
                const lastTab = this.lastTab;
                this.lastTab = true;
                this.curPress = "tab";
                const curLine = inputModel.curLine;
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
            }
            return true;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "generic:confirm", (waveEvent) => {
            GlobalModel.closeTabSettings();
            if (GlobalModel.inputModel.isEmpty()) {
                const activeWindow = GlobalModel.getScreenLinesForActiveScreen();
                const activeScreen = GlobalModel.getActiveScreen();
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
            inputModel.closeAuxView();
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
            const rtn = inputObject.arrowUpPressed();
            return rtn;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "generic:selectBelow", (waveEvent) => {
            this.curPress = "historyupdown";
            const rtn = inputObject.arrowDownPressed();
            return rtn;
        });
        keybindManager.registerKeybinding("pane", "cmdinput", "generic:selectRight", (waveEvent) => {
            return inputObject.arrowRightPressed();
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
class TextAreaInput extends React.Component<{ screen: Screen; onHeightChange: () => void }, {}> {
    lastHistoryUpDown: boolean = false;
    lastFocusType: string = null;
    mainInputRef: React.RefObject<HTMLTextAreaElement> = React.createRef();
    historyInputRef: React.RefObject<HTMLInputElement> = React.createRef();
    controlRef: React.RefObject<HTMLDivElement> = React.createRef();
    lastHeight: number = 0;
    lastSP: StrWithPos = { str: "", pos: appconst.NoStrPos };
    version: OV<number> = mobx.observable.box(0, { name: "textAreaInput-version" }); // forces render updates

    @mobx.action
    incVersion(): void {
        const v = this.version.get();
        this.version.set(v + 1);
    }

    getCurSP(): StrWithPos {
        const textarea = this.mainInputRef.current;
        if (textarea == null) {
            return this.lastSP;
        }
        const str = textarea.value;
        const pos = textarea.selectionStart;
        const endPos = textarea.selectionEnd;
        if (pos != endPos) {
            return { str, pos: appconst.NoStrPos };
        }
        return { str, pos };
    }

    updateSP(): void {
        const curSP = this.getCurSP();
        if (curSP.str == this.lastSP.str && curSP.pos == this.lastSP.pos) {
            return;
        }
        this.lastSP = curSP;
        GlobalModel.sendCmdInputText(this.props.screen.screenId, curSP);
    }

    @mobx.action
    setFocus(): void {
        GlobalModel.inputModel.giveFocus();
    }

    getTextAreaMaxCols(): number {
        const taElem = this.mainInputRef.current;
        if (taElem == null) {
            return 0;
        }
        const cs = window.getComputedStyle(taElem);
        const padding = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const borders = parseFloat(cs.borderLeft) + parseFloat(cs.borderRight);
        const contentWidth = taElem.clientWidth - padding - borders;
        const fontSize = getMonoFontSize(parseInt(cs.fontSize));
        const maxCols = Math.floor(contentWidth / Math.ceil(fontSize.width));
        return maxCols;
    }

    checkHeight(shouldFire: boolean): void {
        const elem = this.controlRef.current;
        if (elem == null) {
            return;
        }
        const curHeight = elem.offsetHeight;
        if (this.lastHeight == curHeight) {
            return;
        }
        this.lastHeight = curHeight;
        if (shouldFire && this.props.onHeightChange != null) {
            this.props.onHeightChange();
        }
    }

    @mobx.action
    componentDidMount() {
        const activeScreen = GlobalModel.getActiveScreen();
        if (activeScreen != null) {
            const focusType = activeScreen.focusType.get();
            if (focusType == "input") {
                this.setFocus();
            }
            this.lastFocusType = focusType;
        }
        this.checkHeight(false);
        this.updateSP();
    }

    @mobx.action
    componentDidUpdate() {
        const activeScreen = GlobalModel.getActiveScreen();
        if (activeScreen != null) {
            const focusType = activeScreen.focusType.get();
            if (this.lastFocusType != focusType && focusType == "input") {
                this.setFocus();
            }
            this.lastFocusType = focusType;
        }
        const inputModel = GlobalModel.inputModel;
        const fcpos = inputModel.forceCursorPos.get();
        if (fcpos != null && fcpos != appconst.NoStrPos) {
            if (this.mainInputRef.current != null) {
                this.mainInputRef.current.selectionStart = fcpos;
                this.mainInputRef.current.selectionEnd = fcpos;
            }
            inputModel.forceCursorPos.set(null);
        }
        if (inputModel.forceInputFocus) {
            inputModel.forceInputFocus = false;
            this.setFocus();
        }
        this.checkHeight(true);
        this.updateSP();
    }

    getLinePos(elem: any): { numLines: number; linePos: number } {
        const numLines = elem.value.split("\n").length;
        const linePos = elem.value.substr(0, elem.selectionStart).split("\n").length;
        return { numLines, linePos };
    }

    arrowUpPressed(): boolean {
        const inputModel = GlobalModel.inputModel;
        if (!inputModel.isHistoryLoaded()) {
            this.lastHistoryUpDown = true;
            inputModel.loadHistory(false, 1, "screen");
            return true;
        }
        const currentRef = this.mainInputRef.current;
        if (currentRef == null) {
            return true;
        }
        const linePos = this.getLinePos(currentRef);
        const lastHist = this.lastHistoryUpDown;
        if (!lastHist && linePos.linePos > 1) {
            // regular arrow
            return false;
        }
        inputModel.moveHistorySelection(1);
        this.lastHistoryUpDown = true;
        return true;
    }

    arrowDownPressed(): boolean {
        const inputModel = GlobalModel.inputModel;
        if (!inputModel.isHistoryLoaded()) {
            return true;
        }
        const currentRef = this.mainInputRef.current;
        if (currentRef == null) {
            return true;
        }
        const linePos = this.getLinePos(currentRef);
        const lastHist = this.lastHistoryUpDown;
        if (!lastHist && linePos.linePos < linePos.numLines) {
            // regular arrow
            return false;
        }
        inputModel.moveHistorySelection(-1);
        this.lastHistoryUpDown = true;
        return true;
    }

    @boundMethod
    arrowRightPressed(): boolean {
        // If the cursor is at the end of the line, apply the primary suggestion
        const curSP = this.getCurSP();
        if (curSP.pos < curSP.str.length) {
            return false;
        }
        GlobalModel.autocompleteModel.applyPrimarySuggestion();
        return true;
    }

    scrollPage(up: boolean) {
        const inputModel = GlobalModel.inputModel;
        const infoScroll = inputModel.hasScrollingInfoMsg();
        if (infoScroll) {
            const div = document.querySelector(".cmd-input-info");
            const amt = pageSize(div);
            scrollDiv(div, up ? -amt : amt);
        }
    }

    modEnter() {
        const currentRef = this.mainInputRef.current;
        if (currentRef == null) {
            return;
        }
        currentRef.setRangeText("\n", currentRef.selectionStart, currentRef.selectionEnd, "end");
        GlobalModel.inputModel.curLine = currentRef.value;
    }

    @boundMethod
    onKeyDown(e: any) {}

    @mobx.action.bound
    onChange(e: any) {
        GlobalModel.inputModel.curLine = e.target.value;
    }

    @mobx.action.bound
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
        const selStart = this.mainInputRef.current.selectionStart;
        const value = this.mainInputRef.current.value;
        if (selStart > value.length) {
            return;
        }
        const cutValue = value.substring(0, selStart);
        const restValue = value.substring(selStart);
        const cmdLineUpdate = { str: restValue, pos: 0 };
        navigator.clipboard.writeText(cutValue);
        GlobalModel.inputModel.updateCmdLine(cmdLineUpdate);
    }

    @mobx.action.bound
    controlP() {
        const inputModel = GlobalModel.inputModel;
        if (!inputModel.isHistoryLoaded()) {
            this.lastHistoryUpDown = true;
            inputModel.loadHistory(false, 1, "screen");
            return;
        }
        inputModel.moveHistorySelection(1);
        this.lastHistoryUpDown = true;
    }

    @mobx.action.bound
    controlN() {
        const inputModel = GlobalModel.inputModel;
        inputModel.moveHistorySelection(-1);
        this.lastHistoryUpDown = true;
    }

    @boundMethod
    controlW() {
        if (this.mainInputRef.current == null) {
            return;
        }
        const selStart = this.mainInputRef.current.selectionStart;
        const value = this.mainInputRef.current.value;
        if (selStart > value.length) {
            return;
        }
        let cutSpot = selStart - 1;
        let initial = true;
        for (; cutSpot >= 0; cutSpot--) {
            const ch = value[cutSpot];
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
        const cutValue = value.slice(cutSpot, selStart);
        const prevValue = value.slice(0, cutSpot);
        const restValue = value.slice(selStart);
        const cmdLineUpdate = { str: prevValue + restValue, pos: prevValue.length };
        navigator.clipboard.writeText(cutValue);
        GlobalModel.inputModel.updateCmdLine(cmdLineUpdate);
    }

    @boundMethod
    controlY() {
        if (this.mainInputRef.current == null) {
            return;
        }
        const pastePromise = navigator.clipboard.readText();
        pastePromise.then((clipText) => {
            clipText = clipText ?? "";
            const selStart = this.mainInputRef.current.selectionStart;
            const selEnd = this.mainInputRef.current.selectionEnd;
            const value = this.mainInputRef.current.value;
            if (selStart > value.length || selEnd > value.length) {
                return;
            }
            const newValue = value.substring(0, selStart) + clipText + value.substring(selEnd);
            const cmdLineUpdate = { str: newValue, pos: selStart + clipText.length };
            GlobalModel.inputModel.updateCmdLine(cmdLineUpdate);
        });
    }

    @mobx.action.bound
    handleHistoryInput(e: any) {
        const inputModel = GlobalModel.inputModel;
        const opts = mobx.toJS(inputModel.historyQueryOpts.get());
        opts.queryStr = e.target.value;
        inputModel.setHistoryQueryOpts(opts);
    }

    @mobx.action.bound
    handleFocus(e: any) {
        e.preventDefault();
        GlobalModel.inputModel.giveFocus();
    }

    @boundMethod
    handleMainBlur(e: any) {
        if (document.activeElement == this.mainInputRef.current) {
            return;
        }
        GlobalModel.inputModel.setPhysicalInputFocused(false);
    }

    @boundMethod
    handleHistoryBlur(e: any) {
        if (document.activeElement == this.historyInputRef.current) {
            return;
        }
        GlobalModel.inputModel.setPhysicalInputFocused(false);
    }

    render() {
        const model = GlobalModel;
        const inputModel = model.inputModel;
        const curLine = inputModel.curLine;
        let displayLines = 1;
        const numLines = curLine.split("\n").length;
        const maxCols = this.getTextAreaMaxCols();
        let longLine = false;
        if (maxCols != 0 && curLine.length >= maxCols - 4) {
            longLine = true;
        }
        if (numLines > 1 || longLine || inputModel.inputExpanded.get()) {
            displayLines = 5;
        }

        const auxViewFocused = inputModel.getAuxViewFocus();
        if (auxViewFocused) {
            displayLines = 1;
        }
        const activeScreen = GlobalModel.getActiveScreen();
        if (activeScreen != null) {
            activeScreen.focusType.get(); // for reaction
        }
        const termFontSize = GlobalModel.getTermFontSize();
        const fontSize = getMonoFontSize(termFontSize);
        const termPad = fontSize.pad;
        const computedInnerHeight = displayLines * fontSize.height + 2 * termPad;
        const computedOuterHeight = computedInnerHeight + 2 * termPad;
        let shellType: string = "";
        const screen = GlobalModel.getActiveScreen();
        if (screen != null) {
            const ri = screen.getCurRemoteInstance();
            if (ri?.shelltype != null) {
                shellType = ri.shelltype;
            }
            if (shellType == "") {
                const rptr = screen.curRemote.get();
                if (rptr != null) {
                    const remote = GlobalModel.getRemote(rptr.remoteid);
                    if (remote != null) {
                        shellType = remote.defaultshelltype;
                    }
                }
            }
        }

        const renderCmdInputKeybindings = inputModel.shouldRenderAuxViewKeybindings(null);
        const renderHistoryKeybindings = inputModel.shouldRenderAuxViewKeybindings(appconst.InputAuxView_History);

        // Will be null if the feature is disabled
        const primaryAutocompleteSuggestion = GlobalModel.autocompleteModel.getPrimarySuggestionCompletion();

        return (
            <div
                className="textareainput-div control is-expanded"
                ref={this.controlRef}
                style={{ height: computedOuterHeight }}
            >
                <If condition={renderCmdInputKeybindings}>
                    <CmdInputKeybindings inputObject={this} />
                </If>
                <If condition={renderHistoryKeybindings}>
                    <HistoryKeybindings />
                </If>

                <If condition={!util.isBlank(shellType)}>
                    <div className="shelltag">{shellType}</div>
                </If>
                <If condition={primaryAutocompleteSuggestion}>
                    <div
                        className="textarea-ghost"
                        style={{ height: computedInnerHeight, minHeight: computedInnerHeight, fontSize: termFontSize }}
                    >
                        {`${"\xa0".repeat(curLine.length)}${primaryAutocompleteSuggestion}`}
                    </div>
                </If>
                <textarea
                    key="main"
                    ref={this.mainInputRef}
                    spellCheck="false"
                    autoComplete="off"
                    autoCorrect="off"
                    id="main-cmd-input"
                    onFocus={this.handleFocus}
                    onBlur={this.handleMainBlur}
                    style={{ height: computedInnerHeight, minHeight: computedInnerHeight, fontSize: termFontSize }}
                    value={curLine}
                    onKeyDown={this.onKeyDown}
                    onChange={this.onChange}
                    onSelect={this.onSelect}
                    placeholder="Type here..."
                    maxLength={MaxInputLength}
                    className={cn("textarea", { "display-disabled": auxViewFocused })}
                ></textarea>
                <input
                    key="history"
                    ref={this.historyInputRef}
                    spellCheck="false"
                    autoComplete="off"
                    autoCorrect="off"
                    className="history-input"
                    type="text"
                    onFocus={this.handleFocus}
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
