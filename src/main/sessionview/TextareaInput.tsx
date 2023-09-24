import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner } from "../../model";
import { getMonoFontSize } from "../../textmeasure";
import { isModKeyPress, hasNoModifiers } from "../../util";
import "./sessionview.less";

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

@mobxReact.observer
class TextAreaInput extends React.Component<{ onHeightChange: () => void }, {}> {
    lastTab: boolean = false;
    lastHistoryUpDown: boolean = false;
    lastTabCurLine: mobx.IObservableValue<string> = mobx.observable.box(null);
    lastFocusType: string = null;
    mainInputRef: React.RefObject<any>;
    historyInputRef: React.RefObject<any>;
    controlRef: React.RefObject<any>;
    lastHeight: number = 0;

    constructor(props) {
        super(props);
        this.mainInputRef = React.createRef();
        this.historyInputRef = React.createRef();
        this.controlRef = React.createRef();
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
        let maxCols = Math.floor(contentWidth / fontSize.width);
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

    getLinePos(elem: any): { numLines: number; linePos: number } {
        let numLines = elem.value.split("\n").length;
        let linePos = elem.value.substr(0, elem.selectionStart).split("\n").length;
        return { numLines, linePos };
    }

    @mobx.action
    @boundMethod
    onKeyDown(e: any) {
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
            this.lastTab = e.code == "Tab";
            let lastHist = this.lastHistoryUpDown;
            this.lastHistoryUpDown = false;

            if (e.code == "Tab") {
                e.preventDefault();
                if (lastTab) {
                    GlobalModel.submitCommand(
                        "_compgen",
                        null,
                        [curLine],
                        { comppos: String(curLine.length), compshow: "1", nohist: "1" },
                        true
                    );
                    return;
                } else {
                    GlobalModel.submitCommand(
                        "_compgen",
                        null,
                        [curLine],
                        { comppos: String(curLine.length), nohist: "1" },
                        true
                    );
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
                    } else {
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
                    scrollDiv(div, e.code == "PageUp" ? -amt : amt);
                }
            }
            // console.log(e.code, e.keyCode, e.key, event.which, ctrlMod, e);
        })();
    }

    @boundMethod
    onChange(e: any) {
        mobx.action(() => {
            GlobalModel.inputModel.setCurLine(e.target.value);
        })();
    }

    @boundMethod
    onHistoryKeyDown(e: any) {
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
        if (
            e.code == "KeyR" &&
            (e.getModifierState("Meta") || e.getModifierState("Control")) &&
            !e.getModifierState("Shift")
        ) {
            e.preventDefault();
            let opts = mobx.toJS(inputModel.historyQueryOpts.get());
            if (opts.limitRemote) {
                opts.limitRemote = false;
                opts.limitRemoteInstance = false;
            } else {
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
            } else if (htype == "session") {
                htype = "global";
            } else {
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
        let cmdLineUpdate = { cmdline: restValue, cursorpos: 0 };
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
        let cutSpot = selStart - 1;
        let initial = true;
        for (; cutSpot >= 0; cutSpot--) {
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
        let cmdLineUpdate = { cmdline: prevValue + restValue, cursorpos: prevValue.length };
        console.log(
            "ss",
            selStart,
            value,
            "prev[" + prevValue + "]",
            "cut[" + cutValue + "]",
            "rest[" + restValue + "]"
        );
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
            let cmdLineUpdate = { cmdline: newValue, cursorpos: selStart + clipText.length };
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
    }

    @boundMethod
    handleMainBlur(e: any) {
        if (document.activeElement == this.mainInputRef.current) {
            return;
        }
        GlobalModel.inputModel.setPhysicalInputFocused(false);
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
    }

    @boundMethod
    handleHistoryBlur(e: any) {
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
        let computedHeight = displayLines * 24 + 14 + 2; // 24 = height of line, 14 = padding, 2 = border
        return (
            <div className="control cmd-input-control is-expanded" ref={this.controlRef}>
                <textarea
                    key="main"
                    ref={this.mainInputRef}
                    spellCheck="false"
                    autoComplete="off"
                    autoCorrect="off"
                    id="main-cmd-input"
                    onFocus={this.handleMainFocus}
                    onBlur={this.handleMainBlur}
                    style={{ height: computedHeight, minHeight: computedHeight }}
                    value={curLine}
                    onKeyDown={this.onKeyDown}
                    onChange={this.onChange}
                    className={cn("textarea", { "display-disabled": disabled })}
                ></textarea>
                <input
                    key="history"
                    ref={this.historyInputRef}
                    spellCheck="false"
                    autoComplete="off"
                    autoCorrect="off"
                    className="history-input"
                    type="text"
                    onFocus={this.handleHistoryFocus}
                    onKeyDown={this.onHistoryKeyDown}
                    onChange={this.handleHistoryInput}
                    value={inputModel.historyQueryOpts.get().queryStr}
                />
            </div>
        );
    }
}

export { TextAreaInput };
