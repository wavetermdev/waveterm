// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";
import { cn } from "@/util/util";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { memo, useRef, useState } from "react";
import { AIPanelHeader } from "./aipanelheader";
import { AIPanelInput } from "./aipanelinput";
import { AIPanelMessages } from "./aipanelmessages";
import { WaveAIModel } from "./waveai-model";

interface AIPanelProps {
    className?: string;
    onClose?: () => void;
}

const AIPanelComponent = memo(({ className, onClose }: AIPanelProps) => {
    const [input, setInput] = useState("");
    const modelRef = useRef(new WaveAIModel());
    const model = modelRef.current;
    const chatIdRef = useRef(crypto.randomUUID());
    const realMessageRef = useRef<AIMessage>(null);

    const { messages, sendMessage, status } = useChat({
        transport: new DefaultChatTransport({
            api: `${getWebServerEndpoint()}/api/post-chat-message?chatid=${chatIdRef.current}`,
            prepareSendMessagesRequest: (opts) => {
                const msg = realMessageRef.current;
                realMessageRef.current = null;
                return {
                    body: msg,
                };
            },
        }),
        onError: (error) => {
            console.error("AI Chat error:", error);
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || status !== "ready") return;
        const realMessage: AIMessage = {
            messageid: crypto.randomUUID(),
            parts: [{ type: "text", text: input.trim() }],
        };
        realMessageRef.current = realMessage;
        sendMessage({ text: input.trim() });
        setInput("");
    };

    return (
        <div
            className={cn("bg-gray-900 border-t border-gray-600 flex flex-col", className)}
            style={{
                borderRight: "1px solid rgb(75, 85, 99)",
                borderTopRightRadius: "var(--block-border-radius)",
                borderBottomRightRadius: "var(--block-border-radius)",
            }}
        >
            <AIPanelHeader onClose={onClose} model={model} />

            <div className="flex-1 flex flex-col min-h-0">
                <AIPanelMessages messages={messages} status={status} />
                <AIPanelInput input={input} setInput={setInput} onSubmit={handleSubmit} status={status} />
            </div>
        </div>
    );
});

AIPanelComponent.displayName = "AIPanel";

export { AIPanelComponent as AIPanel };
