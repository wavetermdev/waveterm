// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveStreamdown } from "@/app/element/streamdown";
import { cn } from "@/util/util";
import { atom } from "jotai";
import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ZeroAiMessage } from "../types";
import "./chat-area.scss";

export interface ChatAreaProps {
    messages: ZeroAiMessage[];
    streamingMessage?: string | null;
    className?: string;
    codeBlockMaxWidthAtom?: ReturnType<typeof atom<number>>;
}

interface MessageItemProps {
    message: ZeroAiMessage;
    isStreaming?: boolean;
    streamingText?: string;
    codeBlockMaxWidthAtom?: ReturnType<typeof atom<number>>;
}

const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60000);

    if (diffMinutes < 1) {
        return "Just now";
    } else if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
    } else if (diffMinutes < 1440) {
        const hours = Math.floor(diffMinutes / 60);
        return `${hours}h ago`;
    }

    return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const parseStreamingText = (text: string, isStreaming: boolean): string => {
    if (!isStreaming) {
        return text;
    }

    // For streaming, we need to handle incomplete markdown gracefully
    // Streamdown has parseIncompleteMarkdown option, but we ensure the text is valid
    let cleaned = text;

    // Close any unclosed code blocks
    const codeBlockCount = (text.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
        cleaned += "\n```";
    }

    // Close any unclosed inline code
    const inlineCodeCount = (text.match(/`/g) || []).length;
    if (inlineCodeCount % 2 !== 0) {
        cleaned += "`";
    }

    // Close any unclosed bold text
    const boldCount = (text.match(/\*\*/g) || []).length;
    if (boldCount % 2 !== 0) {
        cleaned += "**";
    }

    return cleaned;
};

const MessageItem = ({ message, isStreaming = false, streamingText, codeBlockMaxWidthAtom }: MessageItemProps) => {
    const [isCodeExpanded, setIsCodeExpanded] = useState<Record<number, boolean>>({});

    const handleCodeToggle = useCallback((codeIndex: number) => {
        setIsCodeExpanded((prev) => ({
            ...prev,
            [codeIndex]: !prev[codeIndex],
        }));
    }, []);

    const displayContent = isStreaming && streamingText ? streamingText : message.content;

    return (
        <div className={cn("chat-message-item", `role-${message.role}`)}>
            <div className="chat-message-header">
                <div className="chat-message-role">
                    {message.role === "user" ? (
                        <>
                            <i className="fa-solid fa-user" />
                            <span>User</span>
                        </>
                    ) : (
                        <>
                            <i className="fa-solid fa-robot" />
                            <span>Assistant</span>
                        </>
                    )}
                </div>
                <div className="chat-message-timestamp">{formatTimestamp(message.createdAt)}</div>
            </div>
            <div className="chat-message-content">
                {message.role === "user" ? (
                    <div className="user-message-text">{displayContent}</div>
                ) : (
                    <WaveStreamdown
                        text={parseStreamingText(displayContent, isStreaming)}
                        parseIncompleteMarkdown={isStreaming}
                        className="assistant-message-markdown"
                        codeBlockMaxWidthAtom={codeBlockMaxWidthAtom}
                    />
                )}
            </div>
            {isStreaming && message.role === "assistant" && (
                <div className="chat-message-streaming">
                    <span className="animate-pulse">●</span>
                </div>
            )}
        </div>
    );
};

MessageItem.displayName = "MessageItem";

export const ChatArea = React.memo(
    ({ messages, streamingMessage = null, className, codeBlockMaxWidthAtom }: ChatAreaProps) => {
        const scrollRef = React.useRef<HTMLDivElement>(null);
        const [autoScroll, setAutoScroll] = useState(true);
        const prevMessagesLength = useRef(messages.length);
        const prevStreamingLength = useRef(streamingMessage?.length ?? 0);
        const userScrolledRef = useRef(false);

        // Check if user scrolled up
        const handleScroll = useCallback(() => {
            if (!scrollRef.current) return;

            const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
            const isAtBottom = distanceFromBottom < 50;

            if (!isAtBottom) {
                userScrolledRef.current = true;
                setAutoScroll(false);
            } else {
                userScrolledRef.current = false;
                setAutoScroll(true);
            }
        }, []);

        // Auto scroll to bottom when messages change
        useEffect(() => {
            const messagesChanged = messages.length !== prevMessagesLength.current;
            const streamingChanged = (streamingMessage?.length ?? 0) !== prevStreamingLength.current;

            if ((messagesChanged || streamingChanged) && autoScroll && scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }

            prevMessagesLength.current = messages.length;
            prevStreamingLength.current = streamingMessage?.length ?? 0;

            // Re-enable auto-scroll if user scrolls back to bottom
            if (autoScroll && userScrolledRef.current) {
                userScrolledRef.current = false;
            }
        }, [messages, streamingMessage, autoScroll]);

        // Scroll to bottom on first render
        const initialScrollDone = useRef(false);
        useEffect(() => {
            if (!initialScrollDone.current && scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                initialScrollDone.current = true;
            }
        }, []);

        // Handle scroll to bottom button
        const scrollToBottom = useCallback(() => {
            if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                setAutoScroll(true);
                userScrolledRef.current = false;
            }
        }, []);

        return (
            <div className={cn("chat-area", className)}>
                <div ref={scrollRef} className="chat-area-content" onScroll={handleScroll}>
                    {messages.length === 0 && !streamingMessage ? (
                        <div className="chat-area-empty">
                            <i className="fa-solid fa-comments empty-icon" />
                            <p className="empty-text">Start a conversation</p>
                            <p className="empty-hint">Send a message to begin!</p>
                        </div>
                    ) : (
                        <>
                            {messages.map((message) => (
                                <MessageItem
                                    key={message.id}
                                    message={message}
                                    isStreaming={false}
                                    codeBlockMaxWidthAtom={codeBlockMaxWidthAtom}
                                />
                            ))}
                            {streamingMessage && messages.length > 0 && (
                                <MessageItem
                                    key="streaming"
                                    message={{
                                        id: Date.now(),
                                        sessionId: messages[messages.length - 1].sessionId,
                                        role: "assistant",
                                        content: streamingMessage,
                                        createdAt: Date.now() / 1000,
                                    }}
                                    isStreaming={true}
                                    streamingText={streamingMessage}
                                    codeBlockMaxWidthAtom={codeBlockMaxWidthAtom}
                                />
                            )}
                        </>
                    )}
                </div>

                {!autoScroll && (
                    <button className="chat-area-scroll-bottom" onClick={scrollToBottom} aria-label="Scroll to bottom">
                        <i className="fa-solid fa-arrow-down" />
                    </button>
                )}
            </div>
        );
    }
);

ChatArea.displayName = "ChatArea";
