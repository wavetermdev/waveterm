// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtomValue } from "jotai";
import { memo, useEffect, useRef } from "react";
import { AIMessage } from "./aimessage";
import { ThinkingLevelDropdown } from "./thinkingmode";
import { WaveAIModel } from "./waveai-model";

interface AIPanelMessagesProps {
    messages: any[];
    status: string;
    onContextMenu?: (e: React.MouseEvent) => void;
}

export const AIPanelMessages = memo(({ messages, status, onContextMenu }: AIPanelMessagesProps) => {
    const model = WaveAIModel.getInstance();
    const isPanelOpen = useAtomValue(model.getPanelVisibleAtom());
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const prevStatusRef = useRef<string>(status);

    const scrollToBottom = () => {
        const container = messagesContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
            container.scrollLeft = 0;
        }
    };

    useEffect(() => {
        model.registerScrollToBottom(scrollToBottom);
    }, [model]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        if (isPanelOpen) {
            scrollToBottom();
        }
    }, [isPanelOpen]);

    useEffect(() => {
        const wasStreaming = prevStatusRef.current === "streaming";
        const isNowNotStreaming = status !== "streaming";
        
        if (wasStreaming && isNowNotStreaming) {
            requestAnimationFrame(() => {
                scrollToBottom();
            });
        }
        
        prevStatusRef.current = status;
    }, [status]);

    return (
        <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto p-2 space-y-4 relative"
            onContextMenu={onContextMenu}
        >
            <div className="absolute top-2 left-2 z-10">
                <ThinkingLevelDropdown />
            </div>
            {messages.map((message, index) => {
                const isLastMessage = index === messages.length - 1;
                const isStreaming = status === "streaming" && isLastMessage && message.role === "assistant";
                return <AIMessage key={message.id} message={message} isStreaming={isStreaming} />;
            })}

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
