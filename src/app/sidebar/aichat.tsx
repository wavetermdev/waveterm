// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { GlobalModel } from "@/models";
import { boundMethod } from "autobind-decorator";
import { For, If } from "tsx-control-statements/components";
import { Markdown2, TypingIndicator } from "@/elements";
import type { OverlayScrollbars } from "overlayscrollbars";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import tinycolor from "tinycolor2";

import "./aichat.less";

const outline = "2px solid var(--markdown-outline-color)";

class ChatKeyBindings extends React.Component<{ component: ChatSidebar }, {}> {
    componentDidMount(): void {
        const { component } = this.props;
        const keybindManager = GlobalModel.keybindManager;
        const inputModel = GlobalModel.inputModel;

        keybindManager.registerKeybinding("pane", "sidebarchat", "generic:confirm", (waveEvent) => {
            component.onEnterKeyPressed();
            return true;
        });
        keybindManager.registerKeybinding("pane", "sidebarchat", "generic:expandTextInput", (waveEvent) => {
            component.onExpandInputPressed();
            return true;
        });
        keybindManager.registerKeybinding("pane", "sidebarchat", "sidebarchat:clearHistory", (waveEvent) => {
            inputModel.clearAIAssistantChat();
            return true;
        });
    }

    componentWillUnmount(): void {
        GlobalModel.keybindManager.unregisterDomain("sidebarchat");
    }

    render() {
        return null;
    }
}

class ArrowUpDownKeyBindings extends React.Component<{ component: ChatSidebar }, {}> {
    componentDidMount(): void {
        const { component } = this.props;
        const keybindManager = GlobalModel.keybindManager;

        keybindManager.registerKeybinding("pane", "sbcarrowupdown", "generic:selectAbove", (waveEvent) => {
            return component.onArrowUpPressed();
        });
        keybindManager.registerKeybinding("pane", "sbcarrowupdown", "generic:selectBelow", (waveEvent) => {
            return component.onArrowDownPressed();
        });
    }

    componentWillUnmount(): void {
        GlobalModel.keybindManager.unregisterDomain("sbcarrowupdown");
    }

    render() {
        return null;
    }
}

@mobxReact.observer
class ChatItem extends React.Component<{ chatItem: OpenAICmdInfoChatMessageType; itemCount: number }, {}> {
    handleExecuteCommand(cmd: string) {
        GlobalModel.sidebarchatModel.setCmdToExec(cmd);
        GlobalModel.sidebarchatModel.resetFocus();
        GlobalModel.inputModel.curLine = cmd;
    }

    renderError(err: string): any {
        return <div className="chat-msg-error">{err}</div>;
    }

    render() {
        const { chatItem, itemCount } = this.props;
        const { isassistantresponse, assistantresponse } = chatItem;
        const curKey = "chatmsg-" + itemCount;
        const senderClassName = isassistantresponse ? "chat-msg-assistant" : "chat-msg-user";
        const msgClassName = `chat-msg ${senderClassName}`;

        let innerHTML: React.JSX.Element = (
            <>
                <div className="chat-msg-header">
                    <i className="fa-sharp fa-solid fa-user"></i>
                </div>
                <Markdown2 className="msg-text" text={chatItem.userquery} />
            </>
        );
        if (isassistantresponse) {
            if (assistantresponse.error != null && assistantresponse.error !== "") {
                innerHTML = this.renderError(assistantresponse.error);
            } else {
                if (!assistantresponse?.message) {
                    console.log("ai response is empty...");
                    innerHTML = (
                        <>
                            <div className="chat-msg-header">
                                <i className="fa-sharp fa-solid fa-sparkles"></i>
                            </div>
                            <TypingIndicator />
                        </>
                    );
                } else {
                    innerHTML = (
                        <>
                            <div className="chat-msg-header">
                                <i className="fa-sharp fa-solid fa-sparkles"></i>
                            </div>
                            <Markdown2 text={assistantresponse.message} onClickExecute={this.handleExecuteCommand} />
                        </>
                    );
                }
            }
        }

        const cssVar = GlobalModel.isDev ? "--app-panel-bg-color-dev" : "--app-panel-bg-color";
        const panelBgColor = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
        const color = tinycolor(panelBgColor);
        const newColor = color.isValid() ? tinycolor(panelBgColor).darken(6).toString() : "none";
        const backgroundColor = itemCount % 2 === 0 ? "none" : newColor;

        return (
            <div className={msgClassName} key={curKey} style={{ backgroundColor }}>
                {innerHTML}
            </div>
        );
    }
}

@mobxReact.observer
class ChatWindow extends React.Component<{ chatWindowRef; onRendered }, {}> {
    itemCount: number = 0;
    containerRef: React.RefObject<OverlayScrollbarsComponentRef> = React.createRef();
    osInstance: OverlayScrollbars = null;

    componentDidUpdate() {
        if (this.containerRef?.current && this.osInstance) {
            const { viewport } = this.osInstance.elements();
            viewport.scrollTo({
                behavior: "auto",
                top: this.props.chatWindowRef.current.scrollHeight,
            });
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
        this.osInstance = instance;
        const { viewport } = instance.elements();
        viewport.scrollTo({
            behavior: "auto",
            top: this.props.chatWindowRef.current.scrollHeight,
        });
        this.props.onRendered(instance);
    }

    render() {
        const chatMessageItems = GlobalModel.inputModel.AICmdInfoChatItems.slice();
        const chitem: OpenAICmdInfoChatMessageType = null;
        let idx;
        return (
            <OverlayScrollbarsComponent
                ref={this.containerRef}
                className="scrollable"
                options={{ scrollbars: { autoHide: "leave" } }}
                events={{ initialized: this.onScrollbarInitialized }}
            >
                <div ref={this.props.chatWindowRef} className="chat-window">
                    <div className="filler"></div>
                    <For each="chitem" index="idx" of={chatMessageItems}>
                        <ChatItem key={idx} chatItem={chitem} itemCount={idx + 1} />
                    </For>
                </div>
            </OverlayScrollbarsComponent>
        );
    }
}

@mobxReact.observer
class ChatSidebar extends React.Component<{}, {}> {
    sidebarRef: React.RefObject<HTMLDivElement> = React.createRef<HTMLDivElement>();
    textAreaRef: React.RefObject<HTMLTextAreaElement> = React.createRef<HTMLTextAreaElement>();
    chatWindowRef: React.RefObject<HTMLDivElement> = React.createRef<HTMLDivElement>();
    bindArrowUpDownKeys: OV<boolean> = mobx.observable.box(false, { name: "bindArrowUpDownKeys" });
    value: OV<string> = mobx.observable.box("", { deep: false, name: "value" });
    osInstance: OverlayScrollbars;
    termFontSize: number = 14;
    blockIndex: number;

    constructor(props) {
        super(props);
        mobx.makeObservable(this);
    }

    componentDidUpdate() {
        if (GlobalModel.sidebarchatModel.focused == "input") {
            this.textAreaRef.current.focus();
        }
        if (GlobalModel.sidebarchatModel.hasCmdAndOutput()) {
            const newCmdAndOutput = GlobalModel.sidebarchatModel.getCmdAndOutput();
            const newValue = this.formChatMessage(newCmdAndOutput);
            if (newValue !== this.value.get()) {
                this.value.set(newValue);
                GlobalModel.sidebarchatModel.resetCmdAndOutput();
            }
        }
        this.adjustTextAreaHeight();
    }

    componentDidMount() {
        GlobalModel.sidebarchatModel.setFocus("input", true);
        if (this.sidebarRef.current) {
            this.sidebarRef.current.addEventListener("click", this.handleSidebarClick);
        }
        document.addEventListener("mousedown", this.handleClickOutside);
        this.requestChatUpdate();
    }

    componentWillUnmount() {
        if (this.sidebarRef.current) {
            this.sidebarRef.current.removeEventListener("click", this.handleSidebarClick);
        }
        document.removeEventListener("mousedown", this.handleClickOutside);
    }

    @mobx.action.bound
    handleClickOutside(event) {
        if (this.sidebarRef.current && !this.sidebarRef.current.contains(event.target)) {
            this.onClickOutsideSidebar();
        }
    }

    requestChatUpdate() {
        const chatMessageItems = GlobalModel.inputModel.AICmdInfoChatItems.slice();
        if (chatMessageItems == null || chatMessageItems.length === 0) {
            this.submitChatMessage("");
        }
    }

    @mobx.action.bound
    onTextAreaChange(e) {
        const newValue = e.target.value;
        this.value.set(newValue);
        this.adjustTextAreaHeight();
    }

    adjustTextAreaHeight() {
        if (this.textAreaRef.current == null) {
            return;
        }

        // Adjust the height of the textarea to fit the text
        const textAreaMaxLines = 100;
        const textAreaLineHeight = this.termFontSize * 1.5;
        const textAreaMinHeight = textAreaLineHeight;
        const textAreaMaxHeight = textAreaLineHeight * textAreaMaxLines;

        this.textAreaRef.current.style.height = "1px";
        const scrollHeight = this.textAreaRef.current.scrollHeight;
        const newHeight = Math.min(Math.max(scrollHeight, textAreaMinHeight), textAreaMaxHeight);
        this.textAreaRef.current.style.height = newHeight + "px";
    }

    submitChatMessage(messageStr: string) {
        GlobalModel.sidebarchatModel.resetCmdAndOutput();
        const curLine = GlobalModel.inputModel.curLine;
        const prtn = GlobalModel.submitChatInfoCommand(messageStr, curLine, false);
        prtn.then((rtn) => {
            if (!rtn.success) {
                console.log("submit chat command error: " + rtn.error);
            }
        }).catch((_) => {});
    }

    onClickOutsideSidebar() {
        GlobalModel.sidebarchatModel.resetFocus();
    }

    @mobx.action.bound
    onTextAreaFocused(e) {
        GlobalModel.sidebarchatModel.setFocus("input", true);
        this.bindArrowUpDownKeys.set(false);
        this.onTextAreaChange(e);
        this.updatePreTagOutline();
    }

    onEnterKeyPressed() {
        const messageStr = this.value.get();
        this.submitChatMessage(messageStr);
        this.value.set("");
        GlobalModel.sidebarchatModel.resetCmdAndOutput();
    }

    onExpandInputPressed() {
        const currentRef = this.textAreaRef.current;
        if (currentRef == null) {
            return;
        }
        currentRef.setRangeText("\n", currentRef.selectionStart, currentRef.selectionEnd, "end");
    }

    updatePreTagOutline(clickedPre?) {
        const pres = this.chatWindowRef.current?.querySelectorAll("pre");
        if (pres == null) {
            return;
        }
        pres.forEach((preElement, idx) => {
            if (preElement === clickedPre) {
                this.blockIndex = idx;
                preElement.style.outline = outline;
            } else {
                preElement.style.outline = "none";
            }
        });
    }

    @mobx.action.bound
    handleSidebarClick(event) {
        let detection = 0;
        const target = event.target as HTMLElement;

        if (target.closest(".copy-button")) {
            return;
        }

        const chatWindow = target.closest(".chat-window");
        if (chatWindow) {
            detection++;
        }

        const pre = target.closest("pre");
        if (pre) {
            detection++;
            this.updatePreTagOutline(pre);
        }

        if (detection > 0) {
            this.bindArrowUpDownKeys.set(true);
            GlobalModel.sidebarchatModel.setFocus("block", true);
        }
    }

    updateScrollTop() {
        const pres = this.chatWindowRef.current?.querySelectorAll("pre");
        if (pres == null) {
            return;
        }
        const block = pres[this.blockIndex];
        if (block == null) {
            return;
        }
        const { viewport, scrollOffsetElement } = this.osInstance.elements();
        const chatWindowTop = scrollOffsetElement.scrollTop;
        const chatWindowHeight = this.chatWindowRef.current.clientHeight;
        const chatWindowBottom = chatWindowTop + chatWindowHeight;
        const elemTop = block.offsetTop;
        const elemBottom = elemTop + block.offsetHeight;
        const elementIsInView = elemBottom <= chatWindowBottom && elemTop >= chatWindowTop;

        if (!elementIsInView) {
            let scrollPosition;
            if (elemBottom > chatWindowBottom) {
                scrollPosition = elemTop - chatWindowHeight + block.offsetHeight + 15;
            } else if (elemTop < chatWindowTop) {
                scrollPosition = elemTop - 15;
            }
            viewport.scrollTo({
                behavior: "auto",
                top: scrollPosition,
            });
        }
    }

    @mobx.action.bound
    onChatWindowRendered(osInstance) {
        this.osInstance = osInstance;
    }

    onArrowUpPressed() {
        const pres = this.chatWindowRef.current?.querySelectorAll("pre");
        if (pres == null) {
            return;
        }
        if (this.blockIndex == null) {
            this.blockIndex = pres.length - 1;
        } else if (this.blockIndex > 0) {
            this.blockIndex--;
        }
        this.updatePreTagOutline(pres[this.blockIndex]);
        this.updateScrollTop();
        return true;
    }

    @mobx.action.bound
    onArrowDownPressed() {
        const pres = this.chatWindowRef.current?.querySelectorAll("pre");
        if (pres == null) {
            return;
        }
        if (this.blockIndex == null) {
            return;
        }
        if (this.blockIndex < pres.length - 1 && this.blockIndex >= 0) {
            this.blockIndex++;
            this.updatePreTagOutline(pres[this.blockIndex]);
        } else {
            this.bindArrowUpDownKeys.set(false);
            this.textAreaRef.current.focus();
            this.updatePreTagOutline();
        }
        this.updateScrollTop();
        return true;
    }

    @mobx.action.bound
    formChatMessage(cmdAndOutput) {
        const { cmd, output, usedRows, isError } = cmdAndOutput;
        if (cmd == null || cmd === "") {
            return "";
        }
        // Escape backticks in the output
        let escapedOutput = output ? output.replace(/`/g, "\\`") : "";
        // Truncate the output if usedRows is over 100
        if (usedRows > 100) {
            const outputLines = escapedOutput.split("\n");
            const leadingLines = outputLines.slice(0, 10).join("\n");
            const trailingLines = outputLines.slice(-10).join("\n");
            escapedOutput = `${leadingLines}\n.\n.\n.\n${trailingLines}`;
        }
        let chatMessage = `I ran the command: \`${cmd}\` and got the following output:\n\n`;
        if (escapedOutput !== "") {
            chatMessage += `\`\`\`\n${escapedOutput}\n\`\`\``;
        }
        if (isError) {
            chatMessage += "\n\nHow should I fix this?";
        } else {
            chatMessage += "\n\nWhat should I do next?";
        }
        return chatMessage;
    }

    @mobx.action.bound
    handleKeyDown(e) {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            if (this.bindArrowUpDownKeys.get()) {
                GlobalModel.sidebarchatModel.setFocus("block", true);
                this.textAreaRef.current.blur();
                e.preventDefault();
            }
            const textarea = this.textAreaRef.current;
            const cursorPosition = textarea.selectionStart;
            const textBeforeCursor = textarea.value.slice(0, cursorPosition);

            // Check if the cursor is at the first line
            if (textBeforeCursor.indexOf("\n") === -1 && cursorPosition === 0 && e.key === "ArrowUp") {
                this.bindArrowUpDownKeys.set(true);
            }
        }
    }

    render() {
        const chatMessageItems = GlobalModel.inputModel.AICmdInfoChatItems.slice();
        const renderAIChatKeybindings = GlobalModel.sidebarchatModel.hasFocus;
        const textAreaValue = this.value.get();

        return (
            <div ref={this.sidebarRef} className="sidebarchat">
                <If condition={renderAIChatKeybindings}>
                    <ChatKeyBindings component={this} />
                </If>
                <If condition={this.bindArrowUpDownKeys.get()}>
                    <ArrowUpDownKeyBindings component={this} />
                </If>
                <div className="titlebar">
                    <div className="title-string">Wave AI</div>
                </div>
                {chatMessageItems.length > 0 && (
                    <ChatWindow chatWindowRef={this.chatWindowRef} onRendered={this.onChatWindowRendered} />
                )}
                <div className="sidebarchat-input-wrapper">
                    <textarea
                        key="sidebarchat"
                        ref={this.textAreaRef}
                        autoComplete="off"
                        autoCorrect="off"
                        className="sidebarchat-input chat-textarea"
                        onKeyDown={this.handleKeyDown}
                        onMouseDown={this.onTextAreaFocused}
                        onChange={this.onTextAreaChange}
                        style={{ fontSize: this.termFontSize }}
                        placeholder="Send a Message..."
                        value={textAreaValue}
                    ></textarea>
                </div>
            </div>
        );
    }
}

export { ChatSidebar };
