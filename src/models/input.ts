// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type React from "react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { isBlank } from "@/util/util";
import * as appconst from "@/app/appconst";
import type { Model } from "./model";
import { GlobalCommandRunner } from "./global";
import { app } from "electron";

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
    activeAuxView: OV<InputAuxViewType> = mobx.observable.box(null);
    auxViewFocus: OV<boolean> = mobx.observable.box(false);
    cmdInputHeight: OV<number> = mobx.observable.box(0);
    aiChatTextAreaRef: React.RefObject<HTMLTextAreaElement>;
    aiChatWindowRef: React.RefObject<HTMLDivElement>;
    codeSelectBlockRefArray: Array<React.RefObject<HTMLElement>>;
    codeSelectSelectedIndex: OV<number> = mobx.observable.box(-1);
    codeSelectUuid: string;
    inputPopUpType: OV<string> = mobx.observable.box("none");

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
        this.codeSelectUuid = "";
    }

    setInputMode(inputMode: null | "comment" | "global"): void {
        mobx.action(() => {
            this.inputMode.set(inputMode);
        })();
    }

    toggleHistoryType(): void {
        const opts = mobx.toJS(this.historyQueryOpts.get());
        let htype = opts.queryType;
        if (htype == "screen") {
            htype = "session";
        } else if (htype == "session") {
            htype = "global";
        } else {
            htype = "screen";
        }
        this.setHistoryType(htype);
    }

    toggleRemoteType(): void {
        const opts = mobx.toJS(this.historyQueryOpts.get());
        if (opts.limitRemote) {
            opts.limitRemote = false;
            opts.limitRemoteInstance = false;
        } else {
            opts.limitRemote = true;
            opts.limitRemoteInstance = true;
        }
        this.setHistoryQueryOpts(opts);
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

    // Focuses the main input or the auxiliary view, depending on the active auxiliary view
    giveFocus(): void {
        // Override active view to the main input if aux view does not have focus
        const activeAuxView = this.getAuxViewFocus() ? this.getActiveAuxView() : null;
        mobx.action(() => {
            switch (activeAuxView) {
                case appconst.InputAuxView_History: {
                    const elem: HTMLElement = document.querySelector(".cmd-input input.history-input");
                    if (elem != null) {
                        elem.focus();
                    }
                    break;
                }
                case "aichat":
                    this.setAIChatFocus();
                    break;
                case null: {
                    const elem = document.getElementById("main-cmd-input");
                    if (elem != null) {
                        elem.focus();
                    }
                    this.setPhysicalInputFocused(true);
                    break;
                }
                default: {
                    const elem: HTMLElement = document.querySelector(".cmd-input .auxview");
                    if (elem != null) {
                        elem.focus();
                    }
                    break;
                }
            }
        })();
    }

    setPhysicalInputFocused(isFocused: boolean): void {
        mobx.action(() => {
            this.physicalInputFocused.set(isFocused);
        })();
        if (isFocused) {
            const screen = this.globalModel.getActiveScreen();
            if (screen != null) {
                if (screen.focusType.get() != "input") {
                    GlobalCommandRunner.screenSetFocus("input");
                }
            }
        }
    }

    hasFocus(): boolean {
        const mainInputElem = document.getElementById("main-cmd-input");
        if (document.activeElement == mainInputElem) {
            return true;
        }
        const historyInputElem = document.querySelector(".cmd-input input.history-input");
        if (document.activeElement == historyInputElem) {
            return true;
        }
        let aiChatInputElem = document.querySelector(".cmd-input chat-cmd-input");
        if (document.activeElement == aiChatInputElem) {
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
        const newItems = this.getFilteredHistoryItems();
        if (newItems.length == 0) {
            return 0;
        }
        let bestIdx = 0;
        for (const [i, item] of newItems.entries()) {
            // still start at i=0 to catch the historynum equality case
            if (item.historynum == oldItem.historynum) {
                bestIdx = i;
                break;
            }
            const bestTsDiff = Math.abs(item.ts - newItems[bestIdx].ts);
            const curTsDiff = Math.abs(item.ts - oldItem.ts);
            if (curTsDiff < bestTsDiff) {
                bestIdx = i;
            }
        }
        return bestIdx + 1;
    }

    setHistoryQueryOpts(opts: HistoryQueryOpts): void {
        mobx.action(() => {
            const oldItem = this.getHistorySelectedItem();
            this.historyQueryOpts.set(opts);
            const bestIndex = this.findBestNewIndex(oldItem);
            setTimeout(() => this.setHistoryIndex(bestIndex, true), 10);
        })();
    }

    setOpenAICmdInfoChat(chat: OpenAICmdInfoChatMessageType[]): void {
        this.AICmdInfoChatItems.replace(chat);
        this.codeSelectBlockRefArray = [];
    }

    isHistoryLoaded(): boolean {
        if (this.historyLoading.get()) {
            return false;
        }
        const hitems = this.historyItems.get();
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
        if (this.getActiveAuxView() != appconst.InputAuxView_History) {
            this.dropModHistory(true);
            this.setActiveAuxView(appconst.InputAuxView_History);
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
        const hidx = this.historyIndex.get();
        if (hidx == 0) {
            return null;
        }
        const hitems = this.getFilteredHistoryItems();
        if (hidx > hitems.length) {
            return null;
        }
        return hitems[hidx - 1];
    }

    getFirstHistoryItem(): HistoryItem {
        const hitems = this.getFilteredHistoryItems();
        if (hitems.length == 0) {
            return null;
        }
        return hitems[0];
    }

    setHistorySelectionNum(hnum: string): void {
        const hitems = this.getFilteredHistoryItems();
        for (const [i, hitem] of hitems.entries()) {
            if (hitem.historynum == hnum) {
                this.setHistoryIndex(i + 1);
                return;
            }
        }
    }

    setHistoryInfo(hinfo: HistoryInfoType): void {
        mobx.action(() => {
            const oldItem = this.getHistorySelectedItem();
            const hitems: HistoryItem[] = hinfo.items ?? [];
            this.historyItems.set(hitems);
            this.historyLoading.set(false);
            this.historyQueryOpts.get().queryType = hinfo.historytype;
            if (hinfo.historytype == "session" || hinfo.historytype == "global") {
                this.historyQueryOpts.get().limitRemote = false;
                this.historyQueryOpts.get().limitRemoteInstance = false;
            }
            if (this.historyAfterLoadIndex == -1) {
                const bestIndex = this.findBestNewIndex(oldItem);
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
        const hitems: HistoryItem[] = this.historyItems.get() ?? [];
        const rtn: HistoryItem[] = [];
        const opts: HistoryQueryOpts = mobx.toJS(this.historyQueryOpts.get());
        const ctx = this.globalModel.getUIContext();
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
                const idx = hitem.cmdstr.indexOf(opts.queryStr);
                if (idx == -1) {
                    continue;
                }
            }

            rtn.push(hitem);
        }
        return rtn;
    }

    scrollHistoryItemIntoView(hnum: string): void {
        const elem: HTMLElement = document.querySelector(".cmd-history .hnum-" + hnum);
        if (elem == null) {
            return;
        }
        elem.scrollIntoView({ block: "nearest" });
    }

    grabSelectedHistoryItem(): void {
        const hitem = this.getHistorySelectedItem();
        if (hitem == null) {
            this.resetHistory();
            return;
        }
        mobx.action(() => {
            this.resetInput();
            this.setCurLine(hitem.cmdstr);
        })();
    }

    // Closes the auxiliary view if it is open, focuses the main input
    closeAuxView(): void {
        if (this.activeAuxView.get() == null) {
            return;
        }
        this.setActiveAuxView(null);
    }

    // Gets the active auxiliary view, or null if none
    getActiveAuxView(): InputAuxViewType {
        return this.activeAuxView.get();
    }

    // Sets the active auxiliary view
    setActiveAuxView(view: InputAuxViewType): void {
        if (view == this.activeAuxView.get()) {
            return;
        }
        mobx.action(() => {
            this.auxViewFocus.set(view != null);
            this.activeAuxView.set(view);
        })();
        this.giveFocus();
    }

    // Gets the focus state of the auxiliary view. If true, the view will get focus. Otherwise, the main input will get focus.
    // If the auxiliary view is not open, this will return false.
    getAuxViewFocus(): boolean {
        if (this.getActiveAuxView() == null) {
            return false;
        }
        return this.auxViewFocus.get();
    }

    // Sets the focus state of the auxiliary view. If true, the view will get focus. Otherwise, the main input will get focus.
    setAuxViewFocus(focus: boolean): void {
        if (this.getAuxViewFocus() == focus) {
            return;
        }
        mobx.action(() => {
            this.auxViewFocus.set(focus);
        })();
        this.giveFocus();
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
            if (this.getActiveAuxView() == appconst.InputAuxView_History) {
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
        const hitems = this.getFilteredHistoryItems();
        let idx = this.historyIndex.get() + amt;
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
        })();

        if (info == null && this.getActiveAuxView() == appconst.InputAuxView_Info) {
            this.setActiveAuxView(null);
        } else {
            this.setActiveAuxView(appconst.InputAuxView_Info);
        }

        if (info != null && timeoutMs) {
            this.infoTimeoutId = setTimeout(() => {
                console.log("clearing info msg");
                if (this.activeAuxView.get() != appconst.InputAuxView_Info) {
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
            const curBlockRef = this.codeSelectBlockRefArray[this.codeSelectSelectedIndex.get()];
            const codeText = curBlockRef.current.innerText.replace(/\n$/, ""); // remove trailing newline
            this.setCurLine(codeText);
            this.giveFocus();
        }
    }

    addCodeBlockToCodeSelect(blockRef: React.RefObject<HTMLElement>, uuid: string): number {
        let rtn = -1;
        if (uuid != this.codeSelectUuid) {
            this.codeSelectUuid = uuid;
            this.codeSelectBlockRefArray = [];
        }
        rtn = this.codeSelectBlockRefArray.length;
        this.codeSelectBlockRefArray.push(blockRef);
        return rtn;
    }

    setCodeSelectSelectedCodeBlock(blockIndex: number) {
        mobx.action(() => {
            if (blockIndex >= 0 && blockIndex < this.codeSelectBlockRefArray.length) {
                this.codeSelectSelectedIndex.set(blockIndex);
                const currentRef = this.codeSelectBlockRefArray[blockIndex].current;
                if (currentRef != null && this.aiChatWindowRef?.current != null) {
                    const chatWindowTop = this.aiChatWindowRef.current.scrollTop;
                    const chatWindowBottom = chatWindowTop + this.aiChatWindowRef.current.clientHeight - 100;
                    const elemTop = currentRef.offsetTop;
                    let elemBottom = elemTop - currentRef.offsetHeight;
                    const elementIsInView = elemBottom < chatWindowBottom && elemTop > chatWindowTop;
                    if (!elementIsInView) {
                        this.aiChatWindowRef.current.scrollTop =
                            elemBottom - this.aiChatWindowRef.current.clientHeight / 3;
                    }
                }
            }
            this.codeSelectBlockRefArray = [];
            this.setAIChatFocus();
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
            const incBlockIndex = this.codeSelectSelectedIndex.get() + 1;
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
            const decBlockIndex = this.codeSelectSelectedIndex.get() - 1;
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
        if (this.codeSelectSelectedIndex.get() == direction) {
            return;
        }
        mobx.action(() => {
            this.codeSelectSelectedIndex.set(direction);
            this.codeSelectBlockRefArray = [];
        })();
    }

    openAIAssistantChat(): void {
        this.setActiveAuxView(appconst.InputAuxView_AIChat);
    }

    clearAIAssistantChat(): void {
        const prtn = this.globalModel.submitChatInfoCommand("", "", true);
        prtn.then((rtn) => {
            if (!rtn.success) {
                console.log("submit chat command error: " + rtn.error);
            }
        }).catch((error) => {
            console.log("submit chat command error: ", error);
        });
    }

    hasScrollingInfoMsg(): boolean {
        if (this.activeAuxView.get() !== appconst.InputAuxView_Info) {
            return false;
        }
        const info = this.infoMsg.get();
        if (info == null) {
            return false;
        }
        const div = document.querySelector(".cmd-input-info");
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

        if (this.getActiveAuxView() == appconst.InputAuxView_Info) {
            this.setActiveAuxView(null);
        }
        mobx.action(() => {
            if (setNull) {
                this.infoMsg.set(null);
            }
        })();
    }

    toggleInfoMsg(): void {
        this._clearInfoTimeout();
        if (this.activeAuxView.get() == appconst.InputAuxView_Info) {
            this.setActiveAuxView(null);
        } else if (this.infoMsg.get() != null) {
            this.setActiveAuxView(appconst.InputAuxView_Info);
        }
    }

    @boundMethod
    uiSubmitCommand(): void {
        mobx.action(() => {
            const commandStr = this.getCurLine();
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
        const hidx = this.historyIndex.get();
        mobx.action(() => {
            if (this.modHistory.length <= hidx) {
                this.modHistory.length = hidx + 1;
            }
            this.modHistory[hidx] = val;
        })();
    }

    resetInput(): void {
        mobx.action(() => {
            this.setActiveAuxView(null);
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
        const hidx = this.historyIndex.get();
        if (hidx < this.modHistory.length && this.modHistory[hidx] != null) {
            return this.modHistory[hidx];
        }
        const hitems = this.getFilteredHistoryItems();
        if (hidx == 0 || hitems == null || hidx > hitems.length) {
            return "";
        }
        const hitem = hitems[hidx - 1];
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
            if (this.getActiveAuxView() == appconst.InputAuxView_History) {
                this.setActiveAuxView(null);
            }
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
