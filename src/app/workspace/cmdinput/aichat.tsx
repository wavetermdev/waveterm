// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { GlobalModel } from "@/models";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import { Markdown } from "@/elements";
import { AuxiliaryCmdView } from "./auxview";
import * as appconst from "@/app/appconst";

import "./aichat.less";

class AIChatKeybindings extends React.Component<{ AIChatObject: AIChat }, {}> {
    componentDidMount(): void {
        const AIChatObject = this.props.AIChatObject;
        const keybindManager = GlobalModel.keybindManager;
        const inputModel = GlobalModel.inputModel;

        keybindManager.registerKeybinding("pane", "aichat", "generic:confirm", (waveEvent) => {
            AIChatObject.onEnterKeyPressed();
            return true;
        });
        keybindManager.registerKeybinding("pane", "aichat", "generic:expandTextInput", (waveEvent) => {
            AIChatObject.onExpandInputPressed();
            return true;
        });
        keybindManager.registerKeybinding("pane", "aichat", "generic:cancel", (waveEvent) => {
            inputModel.closeAuxView();
            return true;
        });
        keybindManager.registerKeybinding("pane", "aichat", "aichat:clearHistory", (waveEvent) => {
            inputModel.clearAIAssistantChat();
            return true;
        });
        keybindManager.registerKeybinding("pane", "aichat", "generic:selectAbove", (waveEvent) => {
            return AIChatObject.onArrowUpPressed();
        });
        keybindManager.registerKeybinding("pane", "aichat", "generic:selectBelow", (waveEvent) => {
            return AIChatObject.onArrowDownPressed();
        });
    }

    componentWillUnmount(): void {
        GlobalModel.keybindManager.unregisterDomain("aichat");
    }

    render() {
        return null;
    }
}

@mobxReact.observer
class AIChat extends React.Component<{}, {}> {
    chatListKeyCount: number = 0;
    chatWindowScrollRef: React.RefObject<HTMLDivElement>;
    textAreaRef: React.RefObject<HTMLTextAreaElement>;
    termFontSize: number = 14;

    constructor(props: any) {
        super(props);
        this.chatWindowScrollRef = React.createRef();
        this.textAreaRef = React.createRef();
    }
    componentDidMount() {
        const inputModel = GlobalModel.inputModel;
        if (this.chatWindowScrollRef?.current != null) {
            this.chatWindowScrollRef.current.scrollTop = this.chatWindowScrollRef.current.scrollHeight;
        }
        if (this.textAreaRef.current != null) {
            this.textAreaRef.current.focus();
            inputModel.setCmdInfoChatRefs(this.textAreaRef, this.chatWindowScrollRef);
        }
        this.requestChatUpdate();
        this.onTextAreaChange(null);
    }

    componentDidUpdate() {
        if (this.chatWindowScrollRef?.current != null) {
            this.chatWindowScrollRef.current.scrollTop = this.chatWindowScrollRef.current.scrollHeight;
        }
    }

    requestChatUpdate() {
        this.submitChatMessage("");
    }

    submitChatMessage(messageStr: string) {
        const curLine = GlobalModel.inputModel.curLine;
        const prtn = GlobalModel.submitChatInfoCommand(messageStr, curLine, false);
        prtn.then((rtn) => {
            if (!rtn.success) {
                console.log("submit chat command error: " + rtn.error);
            }
        }).catch((_) => {});
    }

    getLinePos(elem: any): { numLines: number; linePos: number } {
        const numLines = elem.value.split("\n").length;
        const linePos = elem.value.substr(0, elem.selectionStart).split("\n").length;
        return { numLines, linePos };
    }

    @mobx.action.bound
    onTextAreaFocused(e: any) {
        GlobalModel.inputModel.setAuxViewFocus(true);
        this.onTextAreaChange(e);
    }

    @mobx.action.bound
    onTextAreaBlur(e: any) {
        GlobalModel.inputModel.setAuxViewFocus(false);
    }

    // Adjust the height of the textarea to fit the text
    @boundMethod
    onTextAreaChange(e: any) {
        // Calculate the bounding height of the text area
        const textAreaMaxLines = 4;
        const textAreaLineHeight = this.termFontSize * 1.5;
        const textAreaMinHeight = textAreaLineHeight;
        const textAreaMaxHeight = textAreaLineHeight * textAreaMaxLines;

        // Get the height of the wrapped text area content. Courtesy of https://stackoverflow.com/questions/995168/textarea-to-resize-based-on-content-length
        this.textAreaRef.current.style.height = "1px";
        const scrollHeight: number = this.textAreaRef.current.scrollHeight;

        // Set the new height of the text area, bounded by the min and max height.
        const newHeight = Math.min(Math.max(scrollHeight, textAreaMinHeight), textAreaMaxHeight);
        this.textAreaRef.current.style.height = newHeight + "px";
        GlobalModel.inputModel.codeSelectDeselectAll();
    }

    onEnterKeyPressed() {
        const inputModel = GlobalModel.inputModel;
        const currentRef = this.textAreaRef.current;
        if (currentRef == null) {
            return;
        }
        if (inputModel.getCodeSelectSelectedIndex() == -1) {
            const messageStr = currentRef.value;
            this.submitChatMessage(messageStr);
            currentRef.value = "";
        } else {
            mobx.action(() => {
                inputModel.grabCodeSelectSelection();
                inputModel.setAuxViewFocus(false);
            })();
        }
    }

    onExpandInputPressed() {
        const currentRef = this.textAreaRef.current;
        if (currentRef == null) {
            return;
        }
        currentRef.setRangeText("\n", currentRef.selectionStart, currentRef.selectionEnd, "end");
        GlobalModel.inputModel.codeSelectDeselectAll();
    }

    onArrowUpPressed(): boolean {
        const currentRef = this.textAreaRef.current;
        if (currentRef == null) {
            return false;
        }
        if (this.getLinePos(currentRef).linePos > 1) {
            // normal up arrow
            GlobalModel.inputModel.codeSelectDeselectAll();
            return false;
        }
        GlobalModel.inputModel.codeSelectSelectNextOldestCodeBlock();
        return true;
    }

    onArrowDownPressed(): boolean {
        const currentRef = this.textAreaRef.current;
        const inputModel = GlobalModel.inputModel;
        if (currentRef == null) {
            return false;
        }
        if (inputModel.getCodeSelectSelectedIndex() == inputModel.codeSelectBottom) {
            GlobalModel.inputModel.codeSelectDeselectAll();
            return false;
        }
        inputModel.codeSelectSelectNextNewestCodeBlock();
        return true;
    }

    @boundMethod
    onKeyDown(e: any) {}

    renderError(err: string): any {
        return <div className="chat-msg-error">{err}</div>;
    }

    renderChatMessage(chatItem: OpenAICmdInfoChatMessageType): any {
        const curKey = "chatmsg-" + this.chatListKeyCount;
        this.chatListKeyCount++;
        const senderClassName = chatItem.isassistantresponse ? "chat-msg-assistant" : "chat-msg-user";
        const msgClassName = "chat-msg " + senderClassName;
        let innerHTML: React.JSX.Element = (
            <span>
                <div className="chat-msg-header">
                    <i className="fa-sharp fa-solid fa-user"></i>
                    <div className="chat-username">You</div>
                </div>
                <p className="msg-text">{chatItem.userquery}</p>
            </span>
        );
        if (chatItem.isassistantresponse) {
            if (chatItem.assistantresponse.error != null && chatItem.assistantresponse.error != "") {
                innerHTML = this.renderError(chatItem.assistantresponse.error);
            } else {
                innerHTML = (
                    <span>
                        <div className="chat-msg-header">
                            <i className="fa-sharp fa-solid fa-sparkles"></i>
                            <div className="chat-username">AI Assistant</div>
                        </div>
                        <Markdown text={chatItem.assistantresponse.message} codeSelect />
                    </span>
                );
            }
        }

        return (
            <div className={msgClassName} key={curKey}>
                {innerHTML}
            </div>
        );
    }

    render() {
        const chatMessageItems = GlobalModel.inputModel.AICmdInfoChatItems.slice();
        const chitem: OpenAICmdInfoChatMessageType = null;
        const renderKeybindings = GlobalModel.inputModel.shouldRenderAuxViewKeybindings(appconst.InputAuxView_AIChat);
        return (
            <AuxiliaryCmdView
                title="Wave AI"
                className="cmd-aichat"
                onClose={() => GlobalModel.inputModel.closeAuxView()}
                iconClass="fa-sharp fa-solid fa-sparkles"
            >
                <If condition={renderKeybindings}>
                    <AIChatKeybindings AIChatObject={this}></AIChatKeybindings>
                </If>
                <div className="chat-window" ref={this.chatWindowScrollRef}>
                    <div className="filler"></div>
                    <For each="chitem" index="idx" of={chatMessageItems}>
                        {this.renderChatMessage(chitem)}
                    </For>
                </div>
                <div className="chat-input">
                    <textarea
                        key="main"
                        ref={this.textAreaRef}
                        autoComplete="off"
                        autoCorrect="off"
                        id="chat-cmd-input"
                        onFocus={this.onTextAreaFocused}
                        onBlur={this.onTextAreaBlur}
                        onChange={this.onTextAreaChange}
                        onKeyDown={this.onKeyDown}
                        style={{ fontSize: this.termFontSize }}
                        className="chat-textarea"
                        placeholder="Send a Message..."
                    ></textarea>
                </div>
            </AuxiliaryCmdView>
        );
    }
}

export { AIChat };
