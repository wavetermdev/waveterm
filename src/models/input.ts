// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type React from "react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { isBlank } from "../util/util";
import * as appconst from "../app/appconst";
import { Model } from "./model";
import { GlobalCommandRunner } from "./global";

function getDefaultHistoryQueryOpts(): HistoryQueryOpts {
    return {
        queryType: "screen",
        limitRemote: true,
        limitRemoteInstance: true,
        limitUser: true,
        queryStr: "",
        maxItems: 10000,
        includeMeta: true,
        fromTs: 0,
    };
}

class InputModel {
    globalModel: Model;
    historyShow: OV<boolean> = mobx.observable.box(false);
    infoShow: OV<boolean> = mobx.observable.box(false);
    aIChatShow: OV<boolean> = mobx.observable.box(false);
    cmdInputHeight: OV<number> = mobx.observable.box(0);
    aiChatTextAreaRef: React.RefObject<HTMLTextAreaElement>;
    aiChatWindowRef: React.RefObject<HTMLDivElement>;
    codeSelectBlockRefArray: Array<React.RefObject<HTMLElement>>;
    codeSelectSelectedIndex: OV<number> = mobx.observable.box(-1);

    AICmdInfoChatItems: mobx.IObservableArray<OpenAICmdInfoChatMessageType> = mobx.observable.array([], {
        name: "aicmdinfo-chat",
    });
    readonly codeSelectTop: number = -2;
    readonly codeSelectBottom: number = -1;

    historyType: mobx.IObservableValue<HistoryTypeStrs> = mobx.observable.box("screen");
    historyLoading: mobx.IObservableValue<boolean> = mobx.observable.box(false);
    historyAfterLoadIndex: number = 0;
    historyItems: mobx.IObservableValue<HistoryItem[]> = mobx.observable.box(null, {
        name: "history-items",
        deep: false,
    }); // sorted in reverse (most recent is index 0)
    filteredHistoryItems: mobx.IComputedValue<HistoryItem[]> = null;
    historyIndex: mobx.IObservableValue<number> = mobx.observable.box(0, {
        name: "history-index",
    }); // 1-indexed (because 0 is current)
    modHistory: mobx.IObservableArray<string> = mobx.observable.array([""], {
        name: "mod-history",
    });
    historyQueryOpts: OV<HistoryQueryOpts> = mobx.observable.box(getDefaultHistoryQueryOpts());

    infoMsg: OV<InfoType> = mobx.observable.box(null);
    infoTimeoutId: any = null;
    inputMode: OV<null | "comment" | "global"> = mobx.observable.box(null);
    inputExpanded: OV<boolean> = mobx.observable.box(false, {
        name: "inputExpanded",
    });

    // cursor
    forceCursorPos: OV<number> = mobx.observable.box(null);

    // focus
    inputFocused: OV<boolean> = mobx.observable.box(false);
    lineFocused: OV<boolean> = mobx.observable.box(false);
    physicalInputFocused: OV<boolean> = mobx.observable.box(false);
    forceInputFocus: boolean = false;

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
        this.filteredHistoryItems = mobx.computed(() => {
            return this._getFilteredHistoryItems();
        });
        mobx.action(() => {
            this.codeSelectSelectedIndex.set(-1);
            this.codeSelectBlockRefArray = [];
        })();
    }

    setInputMode(inputMode: null | "comment" | "global"): void {
        mobx.action(() => {
            this.inputMode.set(inputMode);
        })();
    }

    onInputFocus(isFocused: boolean): void {
        mobx.action(() => {
            if (isFocused) {
                this.inputFocused.set(true);
                this.lineFocused.set(false);
            } else if (this.inputFocused.get()) {
                this.inputFocused.set(false);
            }
        })();
    }

    onLineFocus(isFocused: boolean): void {
        mobx.action(() => {
            if (isFocused) {
                this.inputFocused.set(false);
                this.lineFocused.set(true);
            } else if (this.lineFocused.get()) {
                this.lineFocused.set(false);
            }
        })();
    }

    _focusCmdInput(): void {
        let elem = document.getElementById("main-cmd-input");
        if (elem != null) {
            elem.focus();
        }
    }

    _focusHistoryInput(): void {
        let elem: HTMLElement = document.querySelector(".cmd-input input.history-input");
        if (elem != null) {
            elem.focus();
        }
    }

    giveFocus(): void {
        if (this.historyShow.get()) {
            this._focusHistoryInput();
        } else {
            this._focusCmdInput();
        }
    }

    setPhysicalInputFocused(isFocused: boolean): void {
        mobx.action(() => {
            this.physicalInputFocused.set(isFocused);
        })();
        if (isFocused) {
            let screen = this.globalModel.getActiveScreen();
            if (screen != null) {
                if (screen.focusType.get() != "input") {
                    GlobalCommandRunner.screenSetFocus("input");
                }
            }
        }
    }

    hasFocus(): boolean {
        let mainInputElem = document.getElementById("main-cmd-input");
        if (document.activeElement == mainInputElem) {
            return true;
        }
        let historyInputElem = document.querySelector(".cmd-input input.history-input");
        if (document.activeElement == historyInputElem) {
            return true;
        }
        return false;
    }

    setHistoryType(htype: HistoryTypeStrs): void {
        if (this.historyQueryOpts.get().queryType == htype) {
            return;
        }
        this.loadHistory(true, -1, htype);
    }

    findBestNewIndex(oldItem: HistoryItem): number {
        if (oldItem == null) {
            return 0;
        }
        let newItems = this.getFilteredHistoryItems();
        if (newItems.length == 0) {
            return 0;
        }
        let bestIdx = 0;
        for (let i = 0; i < newItems.length; i++) {
            // still start at i=0 to catch the historynum equality case
            let item = newItems[i];
            if (item.historynum == oldItem.historynum) {
                bestIdx = i;
                break;
            }
            let bestTsDiff = Math.abs(item.ts - newItems[bestIdx].ts);
            let curTsDiff = Math.abs(item.ts - oldItem.ts);
            if (curTsDiff < bestTsDiff) {
                bestIdx = i;
            }
        }
        return bestIdx + 1;
    }

    setHistoryQueryOpts(opts: HistoryQueryOpts): void {
        mobx.action(() => {
            let oldItem = this.getHistorySelectedItem();
            this.historyQueryOpts.set(opts);
            let bestIndex = this.findBestNewIndex(oldItem);
            setTimeout(() => this.setHistoryIndex(bestIndex, true), 10);
        })();
    }

    setOpenAICmdInfoChat(chat: OpenAICmdInfoChatMessageType[]): void {
        this.AICmdInfoChatItems.replace(chat);
        this.codeSelectBlockRefArray = [];
    }

    setHistoryShow(show: boolean): void {
        if (this.historyShow.get() == show) {
            return;
        }
        mobx.action(() => {
            this.historyShow.set(show);
            if (this.hasFocus()) {
                this.giveFocus();
            }
        })();
    }

    isHistoryLoaded(): boolean {
        if (this.historyLoading.get()) {
            return false;
        }
        let hitems = this.historyItems.get();
        return hitems != null;
    }

    loadHistory(show: boolean, afterLoadIndex: number, htype: HistoryTypeStrs) {
        if (this.historyLoading.get()) {
            return;
        }
        if (this.isHistoryLoaded()) {
            if (this.historyQueryOpts.get().queryType == htype) {
                return;
            }
        }
        this.historyAfterLoadIndex = afterLoadIndex;
        mobx.action(() => {
            this.historyLoading.set(true);
        })();
        GlobalCommandRunner.loadHistory(show, htype);
    }

    openHistory(): void {
        if (this.historyLoading.get()) {
            return;
        }
        if (!this.isHistoryLoaded()) {
            this.loadHistory(true, 0, "screen");
            return;
        }
        if (!this.historyShow.get()) {
            mobx.action(() => {
                this.setHistoryShow(true);
                this.infoShow.set(false);
                this.dropModHistory(true);
                this.giveFocus();
            })();
        }
    }

    updateCmdLine(cmdLine: StrWithPos): void {
        mobx.action(() => {
            this.setCurLine(cmdLine.str);
            if (cmdLine.pos != appconst.NoStrPos) {
                this.forceCursorPos.set(cmdLine.pos);
            }
        })();
    }

    getHistorySelectedItem(): HistoryItem {
        let hidx = this.historyIndex.get();
        if (hidx == 0) {
            return null;
        }
        let hitems = this.getFilteredHistoryItems();
        if (hidx > hitems.length) {
            return null;
        }
        return hitems[hidx - 1];
    }

    getFirstHistoryItem(): HistoryItem {
        let hitems = this.getFilteredHistoryItems();
        if (hitems.length == 0) {
            return null;
        }
        return hitems[0];
    }

    setHistorySelectionNum(hnum: string): void {
        let hitems = this.getFilteredHistoryItems();
        for (let i = 0; i < hitems.length; i++) {
            if (hitems[i].historynum == hnum) {
                this.setHistoryIndex(i + 1);
                return;
            }
        }
    }

    setHistoryInfo(hinfo: HistoryInfoType): void {
        mobx.action(() => {
            let oldItem = this.getHistorySelectedItem();
            let hitems: HistoryItem[] = hinfo.items ?? [];
            this.historyItems.set(hitems);
            this.historyLoading.set(false);
            this.historyQueryOpts.get().queryType = hinfo.historytype;
            if (hinfo.historytype == "session" || hinfo.historytype == "global") {
                this.historyQueryOpts.get().limitRemote = false;
                this.historyQueryOpts.get().limitRemoteInstance = false;
            }
            if (this.historyAfterLoadIndex == -1) {
                let bestIndex = this.findBestNewIndex(oldItem);
                setTimeout(() => this.setHistoryIndex(bestIndex, true), 100);
            } else if (this.historyAfterLoadIndex) {
                if (hitems.length >= this.historyAfterLoadIndex) {
                    this.setHistoryIndex(this.historyAfterLoadIndex);
                }
            }
            this.historyAfterLoadIndex = 0;
            if (hinfo.show) {
                this.openHistory();
            }
        })();
    }

    getFilteredHistoryItems(): HistoryItem[] {
        return this.filteredHistoryItems.get();
    }

    _getFilteredHistoryItems(): HistoryItem[] {
        let hitems: HistoryItem[] = this.historyItems.get() ?? [];
        let rtn: HistoryItem[] = [];
        let opts = mobx.toJS(this.historyQueryOpts.get());
        let ctx = this.globalModel.getUIContext();
        let curRemote: RemotePtrType = ctx.remote;
        if (curRemote == null) {
            curRemote = { ownerid: "", name: "", remoteid: "" };
        }
        curRemote = mobx.toJS(curRemote);
        for (const hitem of hitems) {
            if (hitem.ismetacmd) {
                if (!opts.includeMeta) {
                    continue;
                }
            } else if (opts.limitRemoteInstance) {
                if (hitem.remote == null || isBlank(hitem.remote.remoteid)) {
                    continue;
                }
                if (
                    (curRemote.ownerid ?? "") != (hitem.remote.ownerid ?? "") ||
                    (curRemote.remoteid ?? "") != (hitem.remote.remoteid ?? "") ||
                    (curRemote.name ?? "") != (hitem.remote.name ?? "")
                ) {
                    continue;
                }
            } else if (opts.limitRemote) {
                if (hitem.remote == null || isBlank(hitem.remote.remoteid)) {
                    continue;
                }
                if (
                    (curRemote.ownerid ?? "") != (hitem.remote.ownerid ?? "") ||
                    (curRemote.remoteid ?? "") != (hitem.remote.remoteid ?? "")
                ) {
                    continue;
                }
            }
            if (!isBlank(opts.queryStr)) {
                if (isBlank(hitem.cmdstr)) {
                    continue;
                }
                let idx = hitem.cmdstr.indexOf(opts.queryStr);
                if (idx == -1) {
                    continue;
                }
            }

            rtn.push(hitem);
        }
        return rtn;
    }

    scrollHistoryItemIntoView(hnum: string): void {
        let elem: HTMLElement = document.querySelector(".cmd-history .hnum-" + hnum);
        if (elem == null) {
            return;
        }
        let historyDiv = elem.closest(".cmd-history");
        if (historyDiv == null) {
            return;
        }
        let buffer = 15;
        let titleHeight = 24;
        let titleDiv: HTMLElement = document.querySelector(".cmd-history .history-title");
        if (titleDiv != null) {
            titleHeight = titleDiv.offsetHeight + 2;
        }
        let elemOffset = elem.offsetTop;
        let elemHeight = elem.clientHeight;
        let topPos = historyDiv.scrollTop;
        let endPos = topPos + historyDiv.clientHeight;
        if (elemOffset + elemHeight + buffer > endPos) {
            if (elemHeight + buffer > historyDiv.clientHeight - titleHeight) {
                historyDiv.scrollTop = elemOffset - titleHeight;
                return;
            }
            historyDiv.scrollTop = elemOffset - historyDiv.clientHeight + elemHeight + buffer;
            return;
        }
        if (elemOffset < topPos + titleHeight) {
            if (elemHeight + buffer > historyDiv.clientHeight - titleHeight) {
                historyDiv.scrollTop = elemOffset - titleHeight;
                return;
            }
            historyDiv.scrollTop = elemOffset - titleHeight - buffer;
        }
    }

    grabSelectedHistoryItem(): void {
        let hitem = this.getHistorySelectedItem();
        if (hitem == null) {
            this.resetHistory();
            return;
        }
        mobx.action(() => {
            this.resetInput();
            this.setCurLine(hitem.cmdstr);
        })();
    }

    setHistoryIndex(hidx: number, force?: boolean): void {
        if (hidx < 0) {
            return;
        }
        if (!force && this.historyIndex.get() == hidx) {
            return;
        }
        mobx.action(() => {
            this.historyIndex.set(hidx);
            if (this.historyShow.get()) {
                let hitem = this.getHistorySelectedItem();
                if (hitem == null) {
                    hitem = this.getFirstHistoryItem();
                }
                if (hitem != null) {
                    this.scrollHistoryItemIntoView(hitem.historynum);
                }
            }
        })();
    }

    moveHistorySelection(amt: number): void {
        if (amt == 0) {
            return;
        }
        if (!this.isHistoryLoaded()) {
            return;
        }
        let hitems = this.getFilteredHistoryItems();
        let idx = this.historyIndex.get();
        idx += amt;
        if (idx < 0) {
            idx = 0;
        }
        if (idx > hitems.length) {
            idx = hitems.length;
        }
        this.setHistoryIndex(idx);
    }

    flashInfoMsg(info: InfoType, timeoutMs: number): void {
        this._clearInfoTimeout();
        mobx.action(() => {
            this.infoMsg.set(info);
            if (info == null) {
                this.infoShow.set(false);
            } else {
                this.infoShow.set(true);
                this.setHistoryShow(false);
            }
        })();
        if (info != null && timeoutMs) {
            this.infoTimeoutId = setTimeout(() => {
                if (this.historyShow.get()) {
                    return;
                }
                this.clearInfoMsg(false);
            }, timeoutMs);
        }
    }

    setCmdInfoChatRefs(
        textAreaRef: React.RefObject<HTMLTextAreaElement>,
        chatWindowRef: React.RefObject<HTMLDivElement>
    ) {
        this.aiChatTextAreaRef = textAreaRef;
        this.aiChatWindowRef = chatWindowRef;
    }

    setAIChatFocus() {
        if (this.aiChatTextAreaRef?.current != null) {
            this.aiChatTextAreaRef.current.focus();
        }
    }

    grabCodeSelectSelection() {
        if (
            this.codeSelectSelectedIndex.get() >= 0 &&
            this.codeSelectSelectedIndex.get() < this.codeSelectBlockRefArray.length
        ) {
            let curBlockRef = this.codeSelectBlockRefArray[this.codeSelectSelectedIndex.get()];
            let codeText = curBlockRef.current.innerText;
            codeText = codeText.replace(/\n$/, ""); // remove trailing newline
            this.setCurLine(codeText);
            this.giveFocus();
        }
    }

    addCodeBlockToCodeSelect(blockRef: React.RefObject<HTMLElement>): number {
        let rtn = -1;
        rtn = this.codeSelectBlockRefArray.length;
        this.codeSelectBlockRefArray.push(blockRef);
        return rtn;
    }

    setCodeSelectSelectedCodeBlock(blockIndex: number) {
        mobx.action(() => {
            if (blockIndex >= 0 && blockIndex < this.codeSelectBlockRefArray.length) {
                this.codeSelectSelectedIndex.set(blockIndex);
                let currentRef = this.codeSelectBlockRefArray[blockIndex].current;
                if (currentRef != null) {
                    if (this.aiChatWindowRef?.current != null) {
                        let chatWindowTop = this.aiChatWindowRef.current.scrollTop;
                        let chatWindowBottom = chatWindowTop + this.aiChatWindowRef.current.clientHeight - 100;
                        let elemTop = currentRef.offsetTop;
                        let elemBottom = elemTop - currentRef.offsetHeight;
                        let elementIsInView = elemBottom < chatWindowBottom && elemTop > chatWindowTop;
                        if (!elementIsInView) {
                            this.aiChatWindowRef.current.scrollTop =
                                elemBottom - this.aiChatWindowRef.current.clientHeight / 3;
                        }
                    }
                }
                this.codeSelectBlockRefArray = [];
                this.setAIChatFocus();
            }
        })();
    }

    codeSelectSelectNextNewestCodeBlock() {
        // oldest code block = index 0 in array
        // this decrements codeSelectSelected index
        mobx.action(() => {
            if (this.codeSelectSelectedIndex.get() == this.codeSelectTop) {
                this.codeSelectSelectedIndex.set(this.codeSelectBottom);
            } else if (this.codeSelectSelectedIndex.get() == this.codeSelectBottom) {
                return;
            }
            let incBlockIndex = this.codeSelectSelectedIndex.get() + 1;
            if (this.codeSelectSelectedIndex.get() == this.codeSelectBlockRefArray.length - 1) {
                this.codeSelectDeselectAll();
                if (this.aiChatWindowRef?.current != null) {
                    this.aiChatWindowRef.current.scrollTop = this.aiChatWindowRef.current.scrollHeight;
                }
            }
            if (incBlockIndex >= 0 && incBlockIndex < this.codeSelectBlockRefArray.length) {
                this.setCodeSelectSelectedCodeBlock(incBlockIndex);
            }
        })();
    }

    codeSelectSelectNextOldestCodeBlock() {
        mobx.action(() => {
            if (this.codeSelectSelectedIndex.get() == this.codeSelectBottom) {
                if (this.codeSelectBlockRefArray.length > 0) {
                    this.codeSelectSelectedIndex.set(this.codeSelectBlockRefArray.length);
                } else {
                    return;
                }
            } else if (this.codeSelectSelectedIndex.get() == this.codeSelectTop) {
                return;
            }
            let decBlockIndex = this.codeSelectSelectedIndex.get() - 1;
            if (decBlockIndex < 0) {
                this.codeSelectDeselectAll(this.codeSelectTop);
                if (this.aiChatWindowRef?.current != null) {
                    this.aiChatWindowRef.current.scrollTop = 0;
                }
            }
            if (decBlockIndex >= 0 && decBlockIndex < this.codeSelectBlockRefArray.length) {
                this.setCodeSelectSelectedCodeBlock(decBlockIndex);
            }
        })();
    }

    getCodeSelectSelectedIndex() {
        return this.codeSelectSelectedIndex.get();
    }

    getCodeSelectRefArrayLength() {
        return this.codeSelectBlockRefArray.length;
    }

    codeBlockIsSelected(blockIndex: number): boolean {
        return blockIndex == this.codeSelectSelectedIndex.get();
    }

    codeSelectDeselectAll(direction: number = this.codeSelectBottom) {
        mobx.action(() => {
            this.codeSelectSelectedIndex.set(direction);
            this.codeSelectBlockRefArray = [];
        })();
    }

    openAIAssistantChat(): void {
        mobx.action(() => {
            this.aIChatShow.set(true);
            this.setAIChatFocus();
        })();
    }

    closeAIAssistantChat(): void {
        mobx.action(() => {
            this.aIChatShow.set(false);
            this.giveFocus();
        })();
    }

    clearAIAssistantChat(): void {
        let prtn = this.globalModel.submitChatInfoCommand("", "", true);
        prtn.then((rtn) => {
            if (!rtn.success) {
                console.log("submit chat command error: " + rtn.error);
            }
        }).catch((error) => {
            console.log("submit chat command error: ", error);
        });
    }

    hasScrollingInfoMsg(): boolean {
        if (!this.infoShow.get()) {
            return false;
        }
        let info = this.infoMsg.get();
        if (info == null) {
            return false;
        }
        let div = document.querySelector(".cmd-input-info");
        if (div == null) {
            return false;
        }
        return div.scrollHeight > div.clientHeight;
    }

    _clearInfoTimeout(): void {
        if (this.infoTimeoutId != null) {
            clearTimeout(this.infoTimeoutId);
            this.infoTimeoutId = null;
        }
    }

    clearInfoMsg(setNull: boolean): void {
        this._clearInfoTimeout();
        mobx.action(() => {
            this.setHistoryShow(false);
            this.infoShow.set(false);
            if (setNull) {
                this.infoMsg.set(null);
            }
        })();
    }

    toggleInfoMsg(): void {
        this._clearInfoTimeout();
        mobx.action(() => {
            if (this.historyShow.get()) {
                this.setHistoryShow(false);
                return;
            }
            let isShowing = this.infoShow.get();
            if (isShowing) {
                this.infoShow.set(false);
            } else {
                if (this.infoMsg.get() != null) {
                    this.infoShow.set(true);
                }
            }
        })();
    }

    @boundMethod
    uiSubmitCommand(): void {
        mobx.action(() => {
            let commandStr = this.getCurLine();
            if (commandStr.trim() == "") {
                return;
            }
            this.resetInput();
            this.globalModel.submitRawCommand(commandStr, true, true);
        })();
    }

    isEmpty(): boolean {
        return this.getCurLine().trim() == "";
    }

    resetInputMode(): void {
        mobx.action(() => {
            this.setInputMode(null);
            this.setCurLine("");
        })();
    }

    setCurLine(val: string): void {
        let hidx = this.historyIndex.get();
        mobx.action(() => {
            if (this.modHistory.length <= hidx) {
                this.modHistory.length = hidx + 1;
            }
            this.modHistory[hidx] = val;
        })();
    }

    resetInput(): void {
        mobx.action(() => {
            this.setHistoryShow(false);
            this.closeAIAssistantChat();
            this.infoShow.set(false);
            this.inputMode.set(null);
            this.resetHistory();
            this.dropModHistory(false);
            this.infoMsg.set(null);
            this.inputExpanded.set(false);
            this._clearInfoTimeout();
        })();
    }

    @boundMethod
    toggleExpandInput(): void {
        mobx.action(() => {
            this.inputExpanded.set(!this.inputExpanded.get());
            this.forceInputFocus = true;
        })();
    }

    getCurLine(): string {
        let hidx = this.historyIndex.get();
        if (hidx < this.modHistory.length && this.modHistory[hidx] != null) {
            return this.modHistory[hidx];
        }
        let hitems = this.getFilteredHistoryItems();
        if (hidx == 0 || hitems == null || hidx > hitems.length) {
            return "";
        }
        let hitem = hitems[hidx - 1];
        if (hitem == null) {
            return "";
        }
        return hitem.cmdstr;
    }

    dropModHistory(keepLine0: boolean): void {
        mobx.action(() => {
            if (keepLine0) {
                if (this.modHistory.length > 1) {
                    this.modHistory.splice(1, this.modHistory.length - 1);
                }
            } else {
                this.modHistory.replace([""]);
            }
        })();
    }

    resetHistory(): void {
        mobx.action(() => {
            this.setHistoryShow(false);
            this.historyLoading.set(false);
            this.historyType.set("screen");
            this.historyItems.set(null);
            this.historyIndex.set(0);
            this.historyQueryOpts.set(getDefaultHistoryQueryOpts());
            this.historyAfterLoadIndex = 0;
            this.dropModHistory(true);
        })();
    }
}

export { InputModel };
