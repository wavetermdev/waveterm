// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Markdown } from "@/app/element/markdown";
import clsx from "clsx";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { memo, useEffect, useRef } from "react";

import "./chatmessages.scss";

export interface ChatMessage {
    id: string;
    username: string;
    message: string;
    color?: string;
    userIcon?: string;
}

interface ChatMessagesProps {
    messages: ChatMessage[];
    className?: string;
}

const ChatMessages = memo(({ messages, className }: ChatMessagesProps) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const overlayScrollRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        // scrollToBottom();
    }, [messages]);

    return (
        <OverlayScrollbarsComponent
            ref={overlayScrollRef}
            className={clsx("chat-messages", className)}
            options={{ scrollbars: { autoHide: "leave" } }}
        >
            {messages.map(({ id, username, message, color, userIcon }) => (
                <div key={id} className="chat-message">
                    {userIcon && <img src={userIcon} alt="user icon" className="chat-user-icon" />}
                    <span className="chat-username" style={{ color: color || "var(--main-text-color)" }}>
                        {username}:
                    </span>
                    <span className="chat-text">
                        <Markdown scrollable={false} text={message}></Markdown>
                    </span>
                </div>
            ))}
            <div ref={messagesEndRef} />
        </OverlayScrollbarsComponent>
    );
});

ChatMessages.displayName = "ChatMessages";

export { ChatMessages };
