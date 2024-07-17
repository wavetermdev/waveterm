// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Markdown } from "@/app/element/markdown";
import { TypingIndicator } from "@/app/element/typingindicator";
import { ChatMessageType, useWaveAi } from "@/app/store/waveai";
import type { OverlayScrollbars } from "overlayscrollbars";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import tinycolor from "tinycolor2";

import "./waveai.less";

const outline = "2px solid var(--accent-color)";

interface ChatItemProps {
    chatItem: ChatMessageType;
    itemCount: number;
}

const ChatItem = ({ chatItem, itemCount }: ChatItemProps) => {
    const { isAssistant, text, isError } = chatItem;
    const senderClassName = isAssistant ? "chat-msg-assistant" : "chat-msg-user";
    const msgClassName = `chat-msg ${senderClassName}`;
    const cssVar = "--panel-bg-color";
    const panelBgColor = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    const color = tinycolor(panelBgColor);
    const newColor = color.isValid() ? tinycolor(panelBgColor).darken(6).toString() : "none";
    const backgroundColor = itemCount % 2 === 0 ? "none" : newColor;

    const renderError = (err: string): React.JSX.Element => <div className="chat-msg-error">{err}</div>;

    const renderContent = (): React.JSX.Element => {
        if (isAssistant) {
            if (isError) {
                return renderError(isError);
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

const ChatWindow = React.memo(
    forwardRef<OverlayScrollbarsComponentRef, ChatWindowProps>(({ chatWindowRef, messages }, ref) => {
        const [isUserScrolling, setIsUserScrolling] = useState(false);

        const osRef = useRef<OverlayScrollbarsComponentRef>(null);
        const prevMessagesRef = useRef<ChatMessageType[]>(messages);

        useImperativeHandle(ref, () => osRef.current as OverlayScrollbarsComponentRef);

        useEffect(() => {
            const prevMessages = prevMessagesRef.current;
            if (osRef.current && osRef.current.osInstance()) {
                const { viewport } = osRef.current.osInstance().elements();

                if (prevMessages.length !== messages.length || !isUserScrolling) {
                    setIsUserScrolling(false);
                    viewport.scrollTo({
                        behavior: "auto",
                        top: chatWindowRef.current?.scrollHeight || 0,
                    });
                }

                prevMessagesRef.current = messages;
            }
        }, [messages, isUserScrolling]);

        useEffect(() => {
            if (osRef.current && osRef.current.osInstance()) {
                const { viewport } = osRef.current.osInstance().elements();

                const handleUserScroll = () => {
                    setIsUserScrolling(true);
                };

                viewport.addEventListener("wheel", handleUserScroll, { passive: true });
                viewport.addEventListener("touchmove", handleUserScroll, { passive: true });

                return () => {
                    viewport.removeEventListener("wheel", handleUserScroll);
                    viewport.removeEventListener("touchmove", handleUserScroll);
                };
            }
        }, []);

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
    })
);

interface ChatInputProps {
    value: string;
    termFontSize: number;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onMouseDown: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
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

const WaveAi = () => {
    const { messages, sendMessage } = useWaveAi();
    const waveaiRef = useRef<HTMLDivElement>(null);
    const chatWindowRef = useRef<HTMLDivElement>(null);
    const osRef = useRef<OverlayScrollbarsComponentRef>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const submitTimeoutRef = useRef<NodeJS.Timeout>(null);

    const [value, setValue] = useState("");
    const [selectedBlockIdx, setSelectedBlockIdx] = useState<number | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const termFontSize: number = 14;

    useEffect(() => {
        return () => {
            if (submitTimeoutRef.current) {
                clearTimeout(submitTimeoutRef.current);
            }
        };
    }, []);

    const submit = useCallback(
        (messageStr: string) => {
            if (!isSubmitting) {
                setIsSubmitting(true);
                sendMessage(messageStr);

                clearTimeout(submitTimeoutRef.current);
                submitTimeoutRef.current = setTimeout(() => {
                    setIsSubmitting(false);
                }, 500);
            }
        },
        [isSubmitting, sendMessage, setValue]
    );

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

    const handleEnterKeyPressed = useCallback(() => {
        const isCurrentlyUpdating = messages.some((message) => message.isUpdating);
        if (isCurrentlyUpdating || value === "") return;

        submit(value);
        setValue("");
        setSelectedBlockIdx(null);
    }, [messages, value]);

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
        <div ref={waveaiRef} className="waveai" onClick={handleContainerClick}>
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
};

export { WaveAi };
