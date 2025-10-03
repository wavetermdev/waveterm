// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { useAtomValue } from "jotai";
import { memo, useEffect, useRef } from "react";
import { AIMessage } from "./aimessage";

const AIWelcomeMessage = memo(() => {
    return (
        <div className="text-gray-400 text-center py-8">
            <i className="fa fa-sparkles text-4xl text-accent mb-4 block"></i>
            <p className="text-lg">Welcome to Wave AI</p>
            <p className="text-sm mt-2">Start a conversation by typing a message below.</p>
        </div>
    );
});

AIWelcomeMessage.displayName = "AIWelcomeMessage";

interface AIPanelMessagesProps {
    messages: any[];
    status: string;
    isLoadingChat?: boolean;
}

export const AIPanelMessages = memo(({ messages, status, isLoadingChat }: AIPanelMessagesProps) => {
    const isPanelOpen = useAtomValue(WorkspaceLayoutModel.getInstance().panelVisibleAtom);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        const container = messagesContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
            container.scrollLeft = 0;
        }
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        if (isPanelOpen) {
            scrollToBottom();
        }
    }, [isPanelOpen]);

    if (messages.length == 0) {
        return (
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-2 space-y-4">
                {!isLoadingChat && <AIWelcomeMessage />}
            </div>
        );
    }

    return (
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-2 space-y-4">
            {messages.map((message, index) => {
                const isLastMessage = index === messages.length - 1;
                const isStreaming = status === "streaming" && isLastMessage && message.role === "assistant";
                return <AIMessage key={message.id} message={message} isStreaming={isStreaming} />;
            })}

            {/* Show placeholder assistant message when streaming and last message is not assistant */}
            {status === "streaming" &&
                (messages.length === 0 || messages[messages.length - 1].role !== "assistant") && (
                    <AIMessage
                        key="last-message"
                        message={{ role: "assistant", parts: [], id: "last-message" } as any}
                        isStreaming={true}
                    />
                )}

            <div ref={messagesEndRef} />
        </div>
    );
});

AIPanelMessages.displayName = "AIPanelMessages";
