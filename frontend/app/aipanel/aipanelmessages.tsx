// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtomValue } from "jotai";
import { memo, useEffect, useRef } from "react";
import { AIMessage } from "./aimessage";
import { AIModeDropdown } from "./aimode";
import { type WaveUIMessage } from "./aitypes";
import { WaveAIModel } from "./waveai-model";

const AUTO_SCROLL_DEBOUNCE_MS = 100;
const SCROLL_BOTTOM_THRESHOLD_PX = 50;

interface AIPanelMessagesProps {
    messages: WaveUIMessage[];
    status: string;
    onContextMenu?: (e: React.MouseEvent) => void;
}

export const AIPanelMessages = memo(({ messages, status, onContextMenu }: AIPanelMessagesProps) => {
    const model = WaveAIModel.getInstance();
    const isPanelOpen = useAtomValue(model.getPanelVisibleAtom());
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const prevStatusRef = useRef<string>(status);
    const userHasScrolledUp = useRef<boolean>(false);
    const isAutoScrolling = useRef<boolean>(false);

    const scrollToBottom = () => {
        const container = messagesContainerRef.current;
        if (container) {
            isAutoScrolling.current = true;
            container.scrollTop = container.scrollHeight;
            container.scrollLeft = 0;
            userHasScrolledUp.current = false;
            setTimeout(() => {
                isAutoScrolling.current = false;
            }, AUTO_SCROLL_DEBOUNCE_MS);
        }
    };

    // Detect if user has manually scrolled up
    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        const handleScroll = () => {
            // Ignore scroll events triggered by our auto-scroll
            if (isAutoScrolling.current) return;

            const { scrollTop, scrollHeight, clientHeight } = container;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

            // If user is more than threshold from the bottom, they've scrolled up
            if (distanceFromBottom > SCROLL_BOTTOM_THRESHOLD_PX) {
                userHasScrolledUp.current = true;
            } else {
                userHasScrolledUp.current = false;
            }
        };

        container.addEventListener("scroll", handleScroll, { passive: true });
        return () => container.removeEventListener("scroll", handleScroll);
    }, []);

    useEffect(() => {
        model.registerScrollToBottom(scrollToBottom);
    }, [model]);

    useEffect(() => {
        // Only auto-scroll if user hasn't manually scrolled up
        if (!userHasScrolledUp.current) {
            scrollToBottom();
        }
    }, [messages]);

    useEffect(() => {
        if (isPanelOpen && !userHasScrolledUp.current) {
            scrollToBottom();
        }
    }, [isPanelOpen]);

    useEffect(() => {
        const wasStreaming = prevStatusRef.current === "streaming";
        const isNowNotStreaming = status !== "streaming";

        if (wasStreaming && isNowNotStreaming && !userHasScrolledUp.current) {
            requestAnimationFrame(() => {
                scrollToBottom();
            });
        }

        prevStatusRef.current = status;
    }, [status]);

    return (
        <div
            ref={messagesContainerRef}
            className="flex-1 overflow-y-auto p-2 space-y-4"
            onContextMenu={onContextMenu}
        >
            <div className="mb-2">
                <AIModeDropdown compatibilityMode={true} />
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
