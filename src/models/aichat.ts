// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type React from "react";
import * as mobx from "mobx";
import type { Model } from "./model";
import { GlobalCommandRunner } from "./global";

class AIChatModel {
    globalModel: Model;
    aiChatTextAreaRef: React.RefObject<HTMLTextAreaElement>;
    aiChatWindowRef: React.RefObject<HTMLDivElement>;
    codeSelectBlockRefArray: Array<React.RefObject<HTMLElement>>;
    codeSelectSelectedIndex: OV<number> = mobx.observable.box(-1);
    codeSelectUuid: string;

    aiCmdInfoChatItems: mobx.IObservableArray<OpenAICmdInfoChatMessageType> = mobx.observable.array([], {
        name: "aicmdinfo-chat",
    });
    readonly codeSelectTop: number = -2;
    readonly codeSelectBottom: number = -1;

    // focus
    physicalInputFocused: OV<boolean> = mobx.observable.box(false);

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
        mobx.makeObservable(this);
        mobx.action(() => {
            this.codeSelectSelectedIndex.set(-1);
            this.codeSelectBlockRefArray = [];
        })();
        this.codeSelectUuid = "";
    }

    // Focuses the main input or the auxiliary view, depending on the active auxiliary view
    @mobx.action
    giveFocus(): void {
        // focus aichat sidebar input
    }

    @mobx.action
    setPhysicalInputFocused(isFocused: boolean): void {
        this.physicalInputFocused.set(isFocused);
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

    @mobx.action
    setOpenAICmdInfoChat(chat: OpenAICmdInfoChatMessageType[]): void {
        this.aiCmdInfoChatItems.replace(chat);
        this.codeSelectBlockRefArray = [];
    }

    closeAuxView(): void {
        // close and give focus back to main input
    }

    shouldRenderAuxViewKeybindings(view: InputAuxViewType): boolean {
        // when aichat sidebar is mounted, it will render the keybindings
        return true;
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

    @mobx.action
    setCodeSelectSelectedCodeBlock(blockIndex: number) {
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
                    this.aiChatWindowRef.current.scrollTop = elemBottom - this.aiChatWindowRef.current.clientHeight / 3;
                }
            }
        }
        this.codeSelectBlockRefArray = [];
    }

    @mobx.action
    codeSelectSelectNextNewestCodeBlock() {
        // oldest code block = index 0 in array
        // this decrements codeSelectSelected index
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
    }

    @mobx.action
    codeSelectSelectNextOldestCodeBlock() {
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

    @mobx.action
    openAIAssistantChat(): void {
        // open aichat sidebar
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
}

export { AIChatModel };
