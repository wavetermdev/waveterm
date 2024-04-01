// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { GlobalModel } from "@/models";
import { isBlank } from "@/util/util";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import { If, For } from "tsx-control-statements/components";
import { Markdown } from "@/elements";
import { checkKeyPressed, adaptFromReactOrNativeKeyEvent } from "@/util/keyutil";

class AIChatKeybindings extends React.Component<{ AIChatObject: AIChat }, {}> {
    componentDidMount(): void {
        let AIChatObject = this.props.AIChatObject;
        let keybindManager = GlobalModel.keybindManager;
        let inputModel = GlobalModel.inputModel;

        keybindManager.registerKeybinding("pane", "aichat", "generic:confirm", (waveEvent) => {
            AIChatObject.onEnterKeyPressed();
            return true;
        });
        keybindManager.registerKeybinding("pane", "aichat", "generic:expandTextInput", (waveEvent) => {
            AIChatObject.onExpandInputPressed();
            return true;
        });
        keybindManager.registerKeybinding("pane", "aichat", "generic:cancel", (waveEvent) => {
            inputModel.closeAIAssistantChat(true);
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
    textAreaNumLines: mobx.IObservableValue<number> = mobx.observable.box(1, { name: "textAreaNumLines" });
    chatWindowScrollRef: React.RefObject<HTMLDivElement>;
    textAreaRef: React.RefObject<HTMLTextAreaElement>;
    isFocused: OV<boolean>;

    constructor(props: any) {
        super(props);
        this.chatWindowScrollRef = React.createRef();
        this.textAreaRef = React.createRef();
        this.isFocused = mobx.observable.box(false, {
            name: "aichat-isfocused",
        });
    }

    componentDidMount() {
        let model = GlobalModel;
        let inputModel = model.inputModel;
        if (this.chatWindowScrollRef != null && this.chatWindowScrollRef.current != null) {
            this.chatWindowScrollRef.current.scrollTop = this.chatWindowScrollRef.current.scrollHeight;
        }
        if (this.textAreaRef.current != null) {
            this.textAreaRef.current.focus();
            inputModel.setCmdInfoChatRefs(this.textAreaRef, this.chatWindowScrollRef);
        }
        this.requestChatUpdate();
    }

    componentDidUpdate() {
        if (this.chatWindowScrollRef != null && this.chatWindowScrollRef.current != null) {
            this.chatWindowScrollRef.current.scrollTop = this.chatWindowScrollRef.current.scrollHeight;
        }
    }

    requestChatUpdate() {
        this.submitChatMessage("");
    }

    submitChatMessage(messageStr: string) {
        let model = GlobalModel;
        let inputModel = model.inputModel;
        let curLine = inputModel.getCurLine();
        let prtn = GlobalModel.submitChatInfoCommand(messageStr, curLine, false);
        prtn.then((rtn) => {
            if (!rtn.success) {
                console.log("submit chat command error: " + rtn.error);
            }
        }).catch((error) => {});
    }

    getLinePos(elem: any): { numLines: number; linePos: number } {
        let numLines = elem.value.split("\n").length;
        let linePos = elem.value.substr(0, elem.selectionStart).split("\n").length;
        return { numLines, linePos };
    }

    onTextAreaFocused(e: any) {
        mobx.action(() => {
            this.isFocused.set(true);
        })();
    }

    onTextAreaBlur(e: any) {
        mobx.action(() => {
            this.isFocused.set(false);
        })();
    }

    onTextAreaChange(e: any) {
        // set height of textarea based on number of newlines
        mobx.action(() => {
            this.textAreaNumLines.set(e.target.value.split(/\n/).length);
            GlobalModel.inputModel.codeSelectDeselectAll();
        })();
    }

    onEnterKeyPressed() {
        let inputModel = GlobalModel.inputModel;
        let currentRef = this.textAreaRef.current;
        if (currentRef == null) {
            return;
        }
        if (inputModel.getCodeSelectSelectedIndex() == -1) {
            let messageStr = currentRef.value;
            this.submitChatMessage(messageStr);
            currentRef.value = "";
        } else {
            inputModel.grabCodeSelectSelection();
        }
    }

    onExpandInputPressed() {
        let currentRef = this.textAreaRef.current;
        if (currentRef == null) {
            return;
        }
        currentRef.setRangeText("\n", currentRef.selectionStart, currentRef.selectionEnd, "end");
        GlobalModel.inputModel.codeSelectDeselectAll();
    }

    onArrowUpPressed(): boolean {
        let currentRef = this.textAreaRef.current;
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
        let currentRef = this.textAreaRef.current;
        let inputModel = GlobalModel.inputModel;
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

    @mobx.action
    @boundMethod
    onKeyDown(e: any) {}

    renderError(err: string): any {
        return <div className="chat-msg-error">{err}</div>;
    }

    renderChatMessage(chatItem: OpenAICmdInfoChatMessageType): any {
        let curKey = "chatmsg-" + this.chatListKeyCount;
        this.chatListKeyCount++;
        let senderClassName = chatItem.isassistantresponse ? "chat-msg-assistant" : "chat-msg-user";
        let msgClassName = "chat-msg " + senderClassName;
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

    renderChatWindow(): any {
        let model = GlobalModel;
        let inputModel = model.inputModel;
        let chatMessageItems = inputModel.AICmdInfoChatItems.slice();
        let chitem: OpenAICmdInfoChatMessageType = null;
        return (
            <div className="chat-window" ref={this.chatWindowScrollRef}>
                <For each="chitem" index="idx" of={chatMessageItems}>
                    {this.renderChatMessage(chitem)}
                </For>
            </div>
        );
    }

    render() {
        let model = GlobalModel;
        let inputModel = model.inputModel;

        const termFontSize = 14;
        const textAreaMaxLines = 4;
        const textAreaLineHeight = termFontSize * 1.5;
        const textAreaPadding = 2 * 0.5 * termFontSize;
        let textAreaMaxHeight = textAreaLineHeight * textAreaMaxLines + textAreaPadding;
        let textAreaInnerHeight = this.textAreaNumLines.get() * textAreaLineHeight + textAreaPadding;
        let renderKeybindings = mobx
            .computed(() => {
                return (
                    this.isFocused.get() ||
                    (GlobalModel.getActiveScreen().getFocusType() == "input" &&
                        GlobalModel.activeMainView.get() == "session")
                );
            })
            .get();
        return (
            <div className="cmd-aichat">
                <If condition={renderKeybindings}>
                    <AIChatKeybindings AIChatObject={this}></AIChatKeybindings>
                </If>
                <div className="cmdinput-titlebar">
                    <div className="title-icon">
                        <i className="fa-sharp fa-solid fa-sparkles" />
                    </div>
                    <div className="title-string">Wave AI</div>
                    <div className="flex-spacer"></div>
                    <div
                        className="close-button"
                        title="Close (ESC)"
                        onClick={() => inputModel.closeAIAssistantChat(true)}
                    >
                        <i className="fa-sharp fa-solid fa-xmark-large" />
                    </div>
                </div>
                <div className="titlebar-spacer" />
                {this.renderChatWindow()}
                <textarea
                    key="main"
                    ref={this.textAreaRef}
                    autoComplete="off"
                    autoCorrect="off"
                    id="chat-cmd-input"
                    onFocus={this.onTextAreaFocused.bind(this)}
                    onBlur={this.onTextAreaBlur.bind(this)}
                    onChange={this.onTextAreaChange.bind(this)}
                    onKeyDown={this.onKeyDown}
                    style={{ height: textAreaInnerHeight, maxHeight: textAreaMaxHeight, fontSize: termFontSize }}
                    className={cn("chat-textarea")}
                    placeholder="Send a Message..."
                ></textarea>
            </div>
        );
    }
}

export { AIChat };
