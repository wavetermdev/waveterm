// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";
import { cn } from "@/util/util";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { memo, useState } from "react";
import { AIPanelHeader } from "./aipanelheader";
import { AIPanelInput } from "./aipanelinput";
import { AIPanelMessages } from "./aipanelmessages";

interface AIPanelProps {
    className?: string;
    onClose?: () => void;
}

const AIPanelComponent = memo(({ className, onClose }: AIPanelProps) => {
    const [input, setInput] = useState("");

    const { messages, sendMessage, status } = useChat({
        transport: new DefaultChatTransport({
            api: `${getWebServerEndpoint()}/api/aichat?waveai=1`,
        }),
        onError: (error) => {
            console.error("AI Chat error:", error);
        },
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || status !== "ready") return;

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
            <AIPanelHeader onClose={onClose} />

            <div className="flex-1 flex flex-col min-h-0">
                <AIPanelMessages messages={messages} status={status} />
                <AIPanelInput input={input} setInput={setInput} onSubmit={handleSubmit} status={status} />
            </div>
        </div>
    );
});

AIPanelComponent.displayName = "AIPanel";

export { AIPanelComponent as AIPanel };
