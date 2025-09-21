// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";
import { cn } from "@/util/util";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { memo, useRef, useState } from "react";
import { isAcceptableFile } from "./ai-utils";
import { AIDroppedFiles } from "./aidroppedfiles";
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
    const [isDragOver, setIsDragOver] = useState(false);
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

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isDragOver) {
            setIsDragOver(true);
        }
    };

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Only set drag over to false if we're actually leaving the drop zone
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        
        if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) {
            setIsDragOver(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const files = Array.from(e.dataTransfer.files);
        const acceptableFiles = files.filter(isAcceptableFile);

        acceptableFiles.forEach(file => {
            model.addFile(file);
        });

        if (acceptableFiles.length < files.length) {
            console.warn(`${files.length - acceptableFiles.length} files were rejected due to unsupported file types`);
        }
    };

    return (
        <div
            className={cn(
                "bg-gray-900 border-t border-gray-600 flex flex-col relative",
                className,
                isDragOver && "bg-gray-800 border-accent"
            )}
            style={{
                borderRight: "1px solid rgb(75, 85, 99)",
                borderTopRightRadius: "var(--block-border-radius)",
                borderBottomRightRadius: "var(--block-border-radius)",
            }}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {isDragOver && (
                <div className="absolute inset-0 bg-accent/20 border-2 border-dashed border-accent rounded-lg flex items-center justify-center z-10">
                    <div className="text-accent text-center">
                        <i className="fa fa-upload text-3xl mb-2"></i>
                        <div className="text-lg font-semibold">Drop files here</div>
                        <div className="text-sm">Images, PDFs, and text/code files supported</div>
                    </div>
                </div>
            )}
            <AIPanelHeader onClose={onClose} model={model} />

            <div className="flex-1 flex flex-col min-h-0">
                <AIPanelMessages messages={messages} status={status} />
                <AIDroppedFiles model={model} />
                <AIPanelInput input={input} setInput={setInput} onSubmit={handleSubmit} status={status} />
            </div>
        </div>
    );
});

AIPanelComponent.displayName = "AIPanel";

export { AIPanelComponent as AIPanel };
