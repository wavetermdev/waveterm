// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveUIMessagePart } from "@/app/aipanel/aitypes";
import { globalStore } from "@/app/store/jotaiStore";
import { getWebServerEndpoint } from "@/util/endpoints";
import { checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import { cn } from "@/util/util";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { memo, useEffect, useRef, useState } from "react";
import { createDataUrl, isAcceptableFile, normalizeMimeType } from "./ai-utils";
import { AIDroppedFiles } from "./aidroppedfiles";
import { AIPanelHeader } from "./aipanelheader";
import { AIPanelInput, type AIPanelInputRef } from "./aipanelinput";
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
    const realMessageRef = useRef<AIMessage>(null);
    const inputRef = useRef<AIPanelInputRef>(null);

    const { messages, sendMessage, status, setMessages } = useChat({
        transport: new DefaultChatTransport({
            api: `${getWebServerEndpoint()}/api/post-chat-message`,
            prepareSendMessagesRequest: (opts) => {
                const msg = realMessageRef.current;
                realMessageRef.current = null;
                return {
                    body: {
                        msg,
                        chatid: globalStore.get(model.chatId),
                        widgetaccess: globalStore.get(model.widgetAccess),
                    },
                };
            },
        }),
        onError: (error) => {
            console.error("AI Chat error:", error);
        },
    });

    // console.log("AICHAT messages", messages);

    const clearChat = () => {
        model.clearChat();
        setMessages([]);
    };

    const handleKeyDown = (waveEvent: WaveKeyboardEvent): boolean => {
        if (checkKeyPressed(waveEvent, "Cmd:k")) {
            clearChat();
            return true;
        }
        return false;
    };

    useEffect(() => {
        const keyHandler = keydownWrapper(handleKeyDown);
        document.addEventListener("keydown", keyHandler);
        return () => {
            document.removeEventListener("keydown", keyHandler);
        };
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || status !== "ready") return;

        const droppedFiles = globalStore.get(model.droppedFiles);

        // Prepare AI message parts (for backend)
        const aiMessageParts: AIMessagePart[] = [{ type: "text", text: input.trim() }];

        // Prepare UI message parts (for frontend display)
        const uiMessageParts: WaveUIMessagePart[] = [];

        if (input.trim()) {
            uiMessageParts.push({ type: "text", text: input.trim() });
        }

        // Process files
        for (const droppedFile of droppedFiles) {
            const normalizedMimeType = normalizeMimeType(droppedFile.file);
            const dataUrl = await createDataUrl(droppedFile.file);

            // For AI message (backend) - use data URL
            aiMessageParts.push({
                type: "file",
                filename: droppedFile.name,
                mimetype: normalizedMimeType,
                url: dataUrl,
                size: droppedFile.file.size,
            });

            uiMessageParts.push({
                type: "data-userfile",
                data: {
                    filename: droppedFile.name,
                    mimetype: normalizedMimeType,
                    size: droppedFile.file.size,
                },
            });
        }

        // realMessage uses AIMessageParts
        const realMessage: AIMessage = {
            messageid: crypto.randomUUID(),
            parts: aiMessageParts,
        };
        realMessageRef.current = realMessage;

        // sendMessage uses UIMessageParts
        sendMessage({ parts: uiMessageParts });

        setInput("");
        model.clearFiles();

        // Keep focus on input after submission
        setTimeout(() => {
            console.log("trying to reset focus", inputRef.current);
            inputRef.current?.focus();
        }, 100);
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

        acceptableFiles.forEach((file) => {
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
                <div className="absolute inset-0 bg-accent/20 border-2 border-dashed border-accent rounded-lg flex items-center justify-center z-10 p-4">
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
                <AIPanelInput
                    ref={inputRef}
                    input={input}
                    setInput={setInput}
                    onSubmit={handleSubmit}
                    status={status}
                />
            </div>
        </div>
    );
});

AIPanelComponent.displayName = "AIPanel";

export { AIPanelComponent as AIPanel };
