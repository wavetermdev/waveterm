// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo, useRef, useEffect } from "react";
import { AIMessage } from "./aimessage";

interface AIPanelMessagesProps {
    messages: any[];
    status: string;
}

export const AIPanelMessages = memo(({ messages, status }: AIPanelMessagesProps) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        const container = messagesContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    };

    const hasMessageContent = (message: any) => {
        if (message.content) return message.content.length > 0;
        if (message.parts) {
            return message.parts.some((part: any) => part.type === "text" && part.text && part.text.length > 0);
        }
        return false;
    };

    const shouldShowThinking = () => {
        if (status !== "streaming") return false;
        if (messages.length === 0) return true;
        const lastMessage = messages[messages.length - 1];
        return lastMessage.role === "assistant" && !hasMessageContent(lastMessage);
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    return (
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-2 space-y-4">
            {messages.length === 0 ? (
                <div className="text-gray-400 text-center py-8">
                    <i className="fa fa-sparkles text-4xl text-accent mb-4 block"></i>
                    <p className="text-lg">Welcome to Wave AI</p>
                    <p className="text-sm mt-2">Start a conversation by typing a message below.</p>
                </div>
            ) : (
                messages.map((message) => (
                    <AIMessage
                        key={message.id}
                        message={message}
                        isStreaming={status === "streaming"}
                    />
                ))
            )}

            {shouldShowThinking() && (
                <div className="flex justify-start">
                    <div className="bg-gray-700 text-gray-100 px-4 py-2 rounded-lg">
                        <div className="flex items-center gap-2">
                            <div className="animate-pulse">
                                <i className="fa fa-circle text-xs"></i>
                                <i className="fa fa-circle text-xs mx-1"></i>
                                <i className="fa fa-circle text-xs"></i>
                            </div>
                            <span className="text-sm text-gray-400">AI is thinking...</span>
                        </div>
                    </div>
                </div>
            )}

            <div ref={messagesEndRef} />
        </div>
    );
});

AIPanelMessages.displayName = "AIPanelMessages";