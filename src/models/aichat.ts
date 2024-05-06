// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type React from "react";
import * as mobx from "mobx";
import { Model } from "./model";
import { GlobalCommandRunner } from "./global";

class AIChatModel {
    globalModel: Model;
    chatTextAreaRef: React.RefObject<HTMLTextAreaElement>;
    chatWindowRef: React.RefObject<HTMLDivElement>;
    codeSelectBlockRefArray: Array<React.RefObject<HTMLElement>>;
    codeSelectSelectedIndex: OV<number> = mobx.observable.box(-1);
    codeSelectUuid: string;
    aiCmdInfoChatItems: mobx.IObservableArray<OpenAICmdInfoChatMessageType> = mobx.observable.array([], {
        name: "aicmdinfo-chat",
    });
    isFocused: OV<boolean> = mobx.observable.box(false, {
        name: "isFocused",
    });
    readonly codeSelectTop: number = -2;
    readonly codeSelectBottom: number = -1;

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
        mobx.makeObservable(this);
        mobx.action(() => {
            this.codeSelectSelectedIndex.set(-1);
            this.codeSelectBlockRefArray = [];
        })();
        this.codeSelectUuid = "";
    }

    @mobx.action
    focus(): void {
        if (this.chatTextAreaRef?.current != null) {
            this.chatTextAreaRef.current.focus();
        }
        this.isFocused.set(true);
    }

    @mobx.action
    unFocus() {
        if (this.chatTextAreaRef?.current != null) {
            this.chatTextAreaRef.current.blur();
        }
        this.isFocused.set(false);
    }

    @mobx.action
    setOpenAICmdInfoChat(chat: OpenAICmdInfoChatMessageType[]): void {
        this.aiCmdInfoChatItems.replace(chat);
        this.codeSelectBlockRefArray = [];
    }

    close(): void {
        // close and give focus back to main input
    }

    shouldRenderKeybindings(view: InputAuxViewType): boolean {
        // when aichat sidebar is mounted, it will render the keybindings
        return true;
    }

    setRefs(textAreaRef: React.RefObject<HTMLTextAreaElement>, chatWindowRef: React.RefObject<HTMLDivElement>) {
        this.chatTextAreaRef = textAreaRef;
        this.chatWindowRef = chatWindowRef;
    }

    unsetRefs() {
        this.chatTextAreaRef = null;
        this.chatWindowRef = null;
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
            if (currentRef != null && this.chatWindowRef?.current != null) {
                const chatWindowTop = this.chatWindowRef.current.scrollTop;
                const chatWindowBottom = chatWindowTop + this.chatWindowRef.current.clientHeight - 100;
                const elemTop = currentRef.offsetTop;
                let elemBottom = elemTop - currentRef.offsetHeight;
                const elementIsInView = elemBottom < chatWindowBottom && elemTop > chatWindowTop;
                if (!elementIsInView) {
                    this.chatWindowRef.current.scrollTop = elemBottom - this.chatWindowRef.current.clientHeight / 3;
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
            if (this.chatWindowRef?.current != null) {
                this.chatWindowRef.current.scrollTop = this.chatWindowRef.current.scrollHeight;
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
            if (this.chatWindowRef?.current != null) {
                this.chatWindowRef.current.scrollTop = 0;
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
