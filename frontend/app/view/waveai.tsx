// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Markdown } from "@/app/element/markdown";
import { TypingIndicator } from "@/app/element/typingindicator";
import { getApi } from "@/app/store/global";
import { ChatMessageType, useWaveAi } from "@/app/store/waveai";
import type { OverlayScrollbars } from "overlayscrollbars";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import tinycolor from "tinycolor2";

import "./waveai.less";

const outline = "2px solid var(--markdown-outline-color)";

interface ChatItemProps {
    chatItem: ChatMessageType;
    itemCount: number;
}

const ChatItem = ({ chatItem, itemCount }: ChatItemProps) => {
    const { isAssistant, text, error } = chatItem;
    const senderClassName = isAssistant ? "chat-msg-assistant" : "chat-msg-user";
    const msgClassName = `chat-msg ${senderClassName}`;
    const cssVar = getApi().isDev ? "--app-panel-bg-color-dev" : "--app-panel-bg-color";
    const panelBgColor = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    const color = tinycolor(panelBgColor);
    const newColor = color.isValid() ? tinycolor(panelBgColor).darken(6).toString() : "none";
    const backgroundColor = itemCount % 2 === 0 ? "none" : newColor;

    const renderError = (err: string): React.JSX.Element => <div className="chat-msg-error">{err}</div>;

    const renderContent = (): React.JSX.Element => {
        if (isAssistant) {
            if (error) {
                return renderError(error);
            }
            return text ? (
                <>
                    <div className="chat-msg-header">
                        <i className="fa-sharp fa-solid fa-sparkles"></i>
                    </div>
                    <Markdown text={text} />
                </>
            ) : (
                <>
                    <div className="chat-msg-header">
                        <i className="fa-sharp fa-solid fa-sparkles"></i>
                    </div>
                    <TypingIndicator className="typing-indicator" />
                </>
            );
        }
        return (
            <>
                <div className="chat-msg-header">
                    <i className="fa-sharp fa-solid fa-user"></i>
                </div>
                <Markdown className="msg-text" text={text} />
            </>
        );
    };

    return (
        <div className={msgClassName} style={{ backgroundColor }}>
            {renderContent()}
        </div>
    );
};

interface ChatWindowProps {
    chatWindowRef: React.RefObject<HTMLDivElement>;
    messages: ChatMessageType[];
}

const ChatWindow = forwardRef<OverlayScrollbarsComponentRef, ChatWindowProps>(({ chatWindowRef, messages }, ref) => {
    const osRef = useRef<OverlayScrollbarsComponentRef>(null);

    useImperativeHandle(ref, () => osRef.current as OverlayScrollbarsComponentRef);

    useEffect(() => {
        if (osRef.current && osRef.current.osInstance()) {
            const { viewport } = osRef.current.osInstance().elements();
            viewport.scrollTo({
                behavior: "auto",
                top: chatWindowRef.current?.scrollHeight || 0,
            });
        }
    }, [messages]);

    useEffect(() => {
        return () => {
            if (osRef.current && osRef.current.osInstance()) {
                osRef.current.osInstance().destroy();
            }
        };
    }, []);

    const handleScrollbarInitialized = (instance: OverlayScrollbars) => {
        const { viewport } = instance.elements();
        viewport.scrollTo({
            behavior: "auto",
            top: chatWindowRef.current?.scrollHeight || 0,
        });
    };

    return (
        <OverlayScrollbarsComponent
            ref={osRef}
            className="scrollable"
            options={{ scrollbars: { autoHide: "leave" } }}
            events={{ initialized: handleScrollbarInitialized }}
        >
            <div ref={chatWindowRef} className="chat-window">
                <div className="filler"></div>
                {messages.map((chitem, idx) => (
                    <ChatItem key={idx} chatItem={chitem} itemCount={idx + 1} />
                ))}
            </div>
        </OverlayScrollbarsComponent>
    );
});

interface ChatInputProps {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onMouseDown: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
    termFontSize: number;
}

const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
    ({ value, onChange, onKeyDown, onMouseDown, termFontSize }, ref) => {
        const textAreaRef = useRef<HTMLTextAreaElement>(null);

        useImperativeHandle(ref, () => textAreaRef.current as HTMLTextAreaElement);

        useEffect(() => {
            if (textAreaRef.current) {
                textAreaRef.current.focus();
            }
        }, []);

        const adjustTextAreaHeight = () => {
            if (textAreaRef.current == null) {
                return;
            }
            // Adjust the height of the textarea to fit the text
            const textAreaMaxLines = 100;
            const textAreaLineHeight = termFontSize * 1.5;
            const textAreaMinHeight = textAreaLineHeight;
            const textAreaMaxHeight = textAreaLineHeight * textAreaMaxLines;

            textAreaRef.current.style.height = "1px";
            const scrollHeight = textAreaRef.current.scrollHeight;
            const newHeight = Math.min(Math.max(scrollHeight, textAreaMinHeight), textAreaMaxHeight);
            textAreaRef.current.style.height = newHeight + "px";
        };

        useEffect(() => {
            adjustTextAreaHeight();
        }, [value]);

        return (
            <textarea
                ref={textAreaRef}
                autoComplete="off"
                autoCorrect="off"
                className="waveai-input"
                onMouseDown={onMouseDown} // When the user clicks on the textarea
                onChange={onChange}
                onKeyDown={onKeyDown}
                style={{ fontSize: termFontSize }}
                placeholder="Send a Message..."
                value={value}
            ></textarea>
        );
    }
);

interface WaveAiProps {
    parentRef: React.MutableRefObject<HTMLDivElement>;
}

const WaveAi = React.memo(({ parentRef }: WaveAiProps) => {
    const { messages, sendMessage } = useWaveAi();
    const waveaiRef = useRef<HTMLDivElement>(null);
    const chatWindowRef = useRef<HTMLDivElement>(null);
    const osRef = useRef<OverlayScrollbarsComponentRef>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const [value, setValue] = useState("");
    const [waveAiHeight, setWaveAiHeight] = useState(0);
    const [selectedBlockIdx, setSelectedBlockIdx] = useState<number | null>(null);

    const termFontSize: number = 14;

    useEffect(() => {
        const parentElement = parentRef.current;
        setWaveAiHeight(parentElement?.getBoundingClientRect().height);

        // Use ResizeObserver to observe changes in the height of parentRef
        const handleResize = () => {
            const webviewHeight = parentElement?.getBoundingClientRect().height;
            setWaveAiHeight(webviewHeight);
        };

        const resizeObserver = new ResizeObserver((entries) => {
            for (let entry of entries) {
                if (entry.target === parentElement) {
                    handleResize();
                }
            }
        });

        resizeObserver.observe(parentElement);

        return () => {
            resizeObserver.disconnect();
        };
    }, []);

    const submit = (messageStr: string) => {
        sendMessage(messageStr);
    };

    const handleTextAreaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setValue(e.target.value);
    };

    const updatePreTagOutline = (clickedPre?: HTMLElement | null) => {
        const pres = chatWindowRef.current?.querySelectorAll("pre");
        if (!pres) return;

        pres.forEach((preElement, idx) => {
            if (preElement === clickedPre) {
                setSelectedBlockIdx(idx);
            } else {
                preElement.style.outline = "none";
            }
        });

        if (clickedPre) {
            clickedPre.style.outline = outline;
        }
    };

    useEffect(() => {
        if (selectedBlockIdx !== null) {
            const pres = chatWindowRef.current?.querySelectorAll("pre");
            if (pres && pres[selectedBlockIdx]) {
                pres[selectedBlockIdx].style.outline = outline;
            }
        }
    }, [selectedBlockIdx]);

    const handleTextAreaMouseDown = () => {
        updatePreTagOutline();
        setSelectedBlockIdx(null);
    };

    const handleEnterKeyPressed = () => {
        submit(value);
        setValue("");
        setSelectedBlockIdx(null);
    };

    const handleContainerClick = (event: React.MouseEvent<HTMLDivElement>) => {
        inputRef.current?.focus();

        const target = event.target as HTMLElement;
        if (
            target.closest(".copy-button") ||
            target.closest(".fa-square-terminal") ||
            target.closest(".waveai-input")
        ) {
            return;
        }

        const pre = target.closest("pre");
        updatePreTagOutline(pre);
    };

    const updateScrollTop = () => {
        const pres = chatWindowRef.current?.querySelectorAll("pre");
        if (!pres || selectedBlockIdx === null) return;

        const block = pres[selectedBlockIdx];
        if (!block || !osRef.current?.osInstance()) return;

        const { viewport, scrollOffsetElement } = osRef.current?.osInstance().elements();
        const chatWindowTop = scrollOffsetElement.scrollTop;
        const chatWindowHeight = chatWindowRef.current.clientHeight;
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
    };

    const shouldSelectCodeBlock = (key: "ArrowUp" | "ArrowDown") => {
        const textarea = inputRef.current;
        const cursorPosition = textarea?.selectionStart || 0;
        const textBeforeCursor = textarea?.value.slice(0, cursorPosition) || "";

        return (
            (textBeforeCursor.indexOf("\n") === -1 && cursorPosition === 0 && key === "ArrowUp") ||
            selectedBlockIdx !== null
        );
    };

    const handleArrowUpPressed = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (shouldSelectCodeBlock("ArrowUp")) {
            e.preventDefault();
            const pres = chatWindowRef.current?.querySelectorAll("pre");
            let blockIndex = selectedBlockIdx;
            if (!pres) return;
            if (blockIndex === null) {
                setSelectedBlockIdx(pres.length - 1);
            } else if (blockIndex > 0) {
                blockIndex--;
                setSelectedBlockIdx(blockIndex);
            }
            updateScrollTop();
        }
    };

    const handleArrowDownPressed = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (shouldSelectCodeBlock("ArrowDown")) {
            e.preventDefault();
            const pres = chatWindowRef.current?.querySelectorAll("pre");
            let blockIndex = selectedBlockIdx;
            if (!pres) return;
            if (blockIndex === null) return;
            if (blockIndex < pres.length - 1 && blockIndex >= 0) {
                setSelectedBlockIdx(++blockIndex);
                updateScrollTop();
            } else {
                inputRef.current.focus();
                setSelectedBlockIdx(null);
            }
            updateScrollTop();
        }
    };

    const handleTextAreaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleEnterKeyPressed();
        } else if (e.key === "ArrowUp") {
            handleArrowUpPressed(e);
        } else if (e.key === "ArrowDown") {
            handleArrowDownPressed(e);
        }
    };

    return (
        <div ref={waveaiRef} className="waveai" onClick={handleContainerClick} style={{ height: waveAiHeight - 27 }}>
            <ChatWindow ref={osRef} chatWindowRef={chatWindowRef} messages={messages} />
            <div className="waveai-input-wrapper">
                <ChatInput
                    ref={inputRef}
                    value={value}
                    onChange={handleTextAreaChange}
                    onKeyDown={handleTextAreaKeyDown}
                    onMouseDown={handleTextAreaMouseDown}
                    termFontSize={termFontSize}
                />
            </div>
        </div>
    );
});

export { WaveAi };
