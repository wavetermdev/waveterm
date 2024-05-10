// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { GlobalModel } from "@/models";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import { Markdown } from "@/elements";
import type { OverlayScrollbars } from "overlayscrollbars";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import tinycolor from "tinycolor2";
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
class ChatContent extends React.Component<{ chatWindowRef }, {}> {
    chatListKeyCount: number = 0;
    containerRef: React.RefObject<OverlayScrollbarsComponentRef> = React.createRef();
    osInstance: OverlayScrollbars = null;

    componentDidUpdate() {
        this.chatListKeyCount = 0;
        if (this.containerRef?.current && this.osInstance) {
            const { viewport } = this.osInstance.elements();
            // viewport.scrollTo({
            //     behavior: "auto",
            //     top: this.props.chatWindowRef.current.scrollHeight,
            // });
        }
    }

    componentWillUnmount() {
        if (this.osInstance) {
            this.osInstance.destroy();
            this.osInstance = null;
        }
    }

    @boundMethod
    onScrollbarInitialized(instance) {
        console.log("got here");
        GlobalModel.inputModel.setChatOsInstance(instance);
        this.osInstance = instance;
        const { viewport } = instance.elements();
        viewport.scrollTo({
            behavior: "auto",
            top: this.props.chatWindowRef.current.scrollHeight,
        });
    }

    renderError(err: string): any {
        return <div className="chat-msg-error">{err}</div>;
    }

    renderChatMessage(chatItem: OpenAICmdInfoChatMessageType): any {
        const curKey = "chatmsg-" + this.chatListKeyCount;
        this.chatListKeyCount++;
        const senderClassName = chatItem.isassistantresponse ? "chat-msg-assistant" : "chat-msg-user";
        const msgClassName = `chat-msg ${senderClassName}`;

        let innerHTML: React.JSX.Element = (
            <>
                <div className="chat-msg-header">
                    <i className="fa-sharp fa-solid fa-user"></i>
                </div>
                <div className="msg-text">{chatItem.userquery}</div>
            </>
        );
        if (chatItem.isassistantresponse) {
            if (chatItem.assistantresponse.error != null && chatItem.assistantresponse.error !== "") {
                innerHTML = this.renderError(chatItem.assistantresponse.error);
            } else {
                innerHTML = (
                    <>
                        <div className="chat-msg-header">
                            <i className="fa-sharp fa-solid fa-sparkles"></i>
                        </div>
                        <Markdown
                            nameSpace={appconst.Markdown_AiChatSidebar}
                            text={chatItem.assistantresponse.message}
                            codeSelect
                        />
                    </>
                );
            }
        }

        const cssVar = GlobalModel.isDev ? "--app-panel-bg-color-dev" : "--app-panel-bg-color";
        const panelBgColor = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
        const color = tinycolor(panelBgColor);
        const newColor = color.isValid() ? tinycolor(panelBgColor).darken(6).toString() : "none";
        const backgroundColor = this.chatListKeyCount % 2 === 0 ? "none" : newColor;

        return (
            <div className={msgClassName} key={curKey} style={{ backgroundColor }}>
                {innerHTML}
            </div>
        );
    }

    render() {
        const chatMessageItems = GlobalModel.inputModel.AICmdInfoChatItems.slice();
        const chitem: OpenAICmdInfoChatMessageType = null;
        return (
            <OverlayScrollbarsComponent
                ref={this.containerRef}
                className="content"
                options={{ scrollbars: { autoHide: "leave" } }}
                events={{ initialized: this.onScrollbarInitialized }}
            >
                <div ref={this.props.chatWindowRef} className="chat-window">
                    <div className="filler"></div>
                    <For each="chitem" index="idx" of={chatMessageItems}>
                        {this.renderChatMessage(chitem)}
                    </For>
                </div>
            </OverlayScrollbarsComponent>
        );
    }
}

@mobxReact.observer
class AIChat extends React.Component<{}, {}> {
    textAreaRef: React.RefObject<HTMLTextAreaElement> = React.createRef();
    chatWindowRef: React.RefObject<HTMLDivElement> = React.createRef();
    termFontSize: number = 14;
    blockIndex: number;

    constructor(props) {
        super(props);
        mobx.makeObservable(this);
    }

    componentDidMount() {
        const inputModel = GlobalModel.inputModel;

        inputModel.openAIAssistantChat();

        if (this.textAreaRef.current != null) {
            this.textAreaRef.current.focus();
            inputModel.setCmdInfoChatRefs(this.textAreaRef, this.chatWindowRef);
        }
        this.requestChatUpdate();
        this.onTextAreaChange(null);
    }

    requestChatUpdate() {
        const chatMessageItems = GlobalModel.inputModel.AICmdInfoChatItems.slice();
        if (chatMessageItems == null || chatMessageItems.length == 0) {
            this.submitChatMessage("");
        }
    }

    // Adjust the height of the textarea to fit the text
    @boundMethod
    onTextAreaChange(e: any) {
        if (this.textAreaRef.current == null) {
            return;
        }
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
        // GlobalModel.inputModel.codeSelectDeselectAll();
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
        GlobalModel.inputModel.setActiveAuxView(appconst.InputAuxView_AIChat);

        this.onTextAreaChange(e);
    }

    @mobx.action.bound
    onTextAreaBlur(e: any) {
        mobx.action(() => {
            GlobalModel.inputModel.setAuxViewFocus(false);
        })();
    }

    // @boundMethod
    // onTextAreaInput(e: any) {
    //     GlobalModel.inputModel.codeSelectDeselectAll();
    // }

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
        // GlobalModel.inputModel.codeSelectDeselectAll();
    }

    onArrowUpPressed(): boolean {
        const codeBlockIds = GlobalModel.inputModel.codeBlockIds.get(appconst.Markdown_AiChatSidebar);
        console.log("arrow up pressed==================");
        const currentRef = this.textAreaRef.current;
        console.log("inputModel.getCodeSelectSelectedIndex()", GlobalModel.inputModel.getCodeSelectSelectedIndex());
        if (currentRef == null) {
            return false;
        }
        if (this.blockIndex == null) {
            // Set to last index (size - 1)
            this.blockIndex = codeBlockIds.size - 1;
        } else if (this.blockIndex > 0) {
            // Decrement the blockIndex
            this.blockIndex--;
        }
        console.log("GlobalModel.inputModel.codeBlockIds.size", codeBlockIds.size);
        console.log("onArrowUpPressed:this.blockIndex", this.blockIndex);
        return true;
    }

    onArrowDownPressed(): boolean {
        const codeBlockIds = GlobalModel.inputModel.codeBlockIds.get(appconst.Markdown_AiChatSidebar);
        console.log("arrow down pressed==================");
        const currentRef = this.textAreaRef.current;
        if (currentRef == null || this.blockIndex == null) {
            // Do nothing if blockIndex has not been initialized yet
            return false;
        }
        console.log("inputModel.getCodeSelectSelectedIndex()", GlobalModel.inputModel.getCodeSelectSelectedIndex());
        if (this.blockIndex < codeBlockIds.size - 1) {
            // Increment the blockIndex
            this.blockIndex++;
        }
        console.log("GlobalModel.inputModel.codeBlockIds.size", codeBlockIds.size);
        console.log("onArrowDownPressed:this.blockIndex", this.blockIndex);
        return true;
    }

    @mobx.action.bound
    onKeyDown(e: any) {}

    renderError(err: string): any {
        return <div className="chat-msg-error">{err}</div>;
    }

    render() {
        const chatMessageItems = GlobalModel.inputModel.AICmdInfoChatItems.slice();
        const renderAIChatKeybindings = GlobalModel.inputModel.shouldRenderAuxViewKeybindings(
            appconst.InputAuxView_AIChat
        );
        console.log("renderAIChatKeybindings=====", renderAIChatKeybindings);
        console.log("codeSelectBlockRefArray", GlobalModel.inputModel.codeSelectBlockRefArray);
        console.log("codeBlockIds", GlobalModel.inputModel.codeBlockIds);

        return (
            <div className="sidebar-aichat">
                <If condition={renderAIChatKeybindings}>
                    <AIChatKeybindings AIChatObject={this}></AIChatKeybindings>
                </If>
                <div className="titlebar">
                    <div className="title-string">Wave AI</div>
                </div>
                <If condition={chatMessageItems.length > 0}>
                    <ChatContent chatWindowRef={this.chatWindowRef} />
                </If>
                <div className="chat-input">
                    <textarea
                        key="main"
                        ref={this.textAreaRef}
                        autoComplete="off"
                        autoCorrect="off"
                        autoFocus={true}
                        className="chat-cmd-input chat-textarea"
                        onFocus={this.onTextAreaFocused}
                        onBlur={this.onTextAreaBlur}
                        onChange={this.onTextAreaChange}
                        // onInput={this.onTextAreaInput}
                        onKeyDown={this.onKeyDown}
                        style={{ fontSize: this.termFontSize }}
                        placeholder="Send a Message..."
                    ></textarea>
                </div>
            </div>
        );
    }
}

export { AIChat };
