// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveUIMessagePart } from "@/app/aipanel/aitypes";
import { waveAIHasSelection } from "@/app/aipanel/waveai-focus-utils";
import { ErrorBoundary } from "@/app/element/errorboundary";
import { focusManager } from "@/app/store/focusManager";
import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { getWebServerEndpoint } from "@/util/endpoints";
import { checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import { cn } from "@/util/util";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import * as jotai from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createDataUrl, formatFileSizeError, isAcceptableFile, normalizeMimeType, validateFileSize } from "./ai-utils";
import { AIDroppedFiles } from "./aidroppedfiles";
import { AIPanelHeader } from "./aipanelheader";
import { AIPanelInput, type AIPanelInputRef } from "./aipanelinput";
import { AIPanelMessages } from "./aipanelmessages";
import { AIRateLimitStrip } from "./airatelimitstrip";
import { TelemetryRequiredMessage } from "./telemetryrequired";
import { WaveAIModel, type DroppedFile } from "./waveai-model";

interface AIPanelProps {
    className?: string;
    onClose?: () => void;
}

const AIPanelComponentInner = memo(({ className, onClose }: AIPanelProps) => {
    const [input, setInput] = useState("");
    const [isDragOver, setIsDragOver] = useState(false);
    const [isLoadingChat, setIsLoadingChat] = useState(true);
    const model = WaveAIModel.getInstance();
    const errorMessage = jotai.useAtomValue(model.errorMessage);
    const realMessageRef = useRef<AIMessage>(null);
    const inputRef = useRef<AIPanelInputRef>(null);
    const isLayoutMode = jotai.useAtomValue(atoms.controlShiftDelayAtom);
    const showOverlayBlockNums = jotai.useAtomValue(getSettingsKeyAtom("app:showoverlayblocknums")) ?? true;
    const focusType = jotai.useAtomValue(focusManager.focusType);
    const isFocused = focusType === "waveai";
    const telemetryEnabled = jotai.useAtomValue(getSettingsKeyAtom("telemetry:enabled")) ?? false;
    const isPanelVisible = jotai.useAtomValue(WorkspaceLayoutModel.getInstance().panelVisibleAtom);

    const { messages, sendMessage, status, setMessages, error } = useChat({
        transport: new DefaultChatTransport({
            api: `${getWebServerEndpoint()}/api/post-chat-message`,
            prepareSendMessagesRequest: (opts) => {
                const msg = realMessageRef.current;
                realMessageRef.current = null;
                return {
                    body: {
                        msg,
                        chatid: globalStore.get(model.chatId),
                        widgetaccess: globalStore.get(model.widgetAccessAtom),
                        tabid: globalStore.get(atoms.staticTabId),
                    },
                };
            },
        }),
        onError: (error) => {
            console.error("AI Chat error:", error);
            model.setError(error.message || "An error occurred");
            setMessages((prevMessages) => {
                if (prevMessages.length > 0 && prevMessages[prevMessages.length - 1].role === "user") {
                    return prevMessages.slice(0, -1);
                }
                return prevMessages;
            });
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

    useEffect(() => {
        model.registerInputRef(inputRef);
    }, [model]);

    useEffect(() => {
        const loadMessages = async () => {
            const messages = await model.loadChat();
            setMessages(messages as any);
            setIsLoadingChat(false);
        };
        loadMessages();
    }, [model, setMessages]);

    useEffect(() => {
        model.ensureRateLimitSet();
    }, [model]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || status !== "ready" || isLoadingChat) return;

        if (input.trim() === "/clear" || input.trim() === "/new") {
            clearChat();
            setInput("");
            return;
        }

        model.clearError();

        const droppedFiles = globalStore.get(model.droppedFiles) as DroppedFile[];

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
                previewurl: droppedFile.previewUrl,
            });

            uiMessageParts.push({
                type: "data-userfile",
                data: {
                    filename: droppedFile.name,
                    mimetype: normalizedMimeType,
                    size: droppedFile.file.size,
                    previewurl: droppedFile.previewUrl,
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

    const hasFilesDragged = (dataTransfer: DataTransfer): boolean => {
        // Check if the drag operation contains files by looking at the types
        return dataTransfer.types.includes("Files");
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const hasFiles = hasFilesDragged(e.dataTransfer);
        if (hasFiles && !isDragOver) {
            setIsDragOver(true);
        } else if (!hasFiles && isDragOver) {
            setIsDragOver(false);
        }
    };

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (hasFilesDragged(e.dataTransfer)) {
            setIsDragOver(true);
        }
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

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const files = Array.from(e.dataTransfer.files);
        const acceptableFiles = files.filter(isAcceptableFile);

        for (const file of acceptableFiles) {
            const sizeError = validateFileSize(file);
            if (sizeError) {
                model.setError(formatFileSizeError(sizeError));
                return;
            }
            await model.addFile(file);
        }

        if (acceptableFiles.length < files.length) {
            const rejectedCount = files.length - acceptableFiles.length;
            const rejectedFiles = files.filter((f) => !isAcceptableFile(f));
            const fileNames = rejectedFiles.map((f) => f.name).join(", ");
            model.setError(
                `${rejectedCount} file${rejectedCount > 1 ? "s" : ""} rejected (unsupported type): ${fileNames}. Supported: images, PDFs, and text/code files.`
            );
        }
    };

    const handleFocusCapture = useCallback((event: React.FocusEvent) => {
        // console.log("Wave AI focus capture", getElemAsStr(event.target));
        focusManager.requestWaveAIFocus();
    }, []);

    const handleClick = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        const isInteractive = target.closest('button, a, input, textarea, select, [role="button"], [tabindex]');

        if (isInteractive) {
            return;
        }

        const hasSelection = waveAIHasSelection();
        if (hasSelection) {
            focusManager.requestWaveAIFocus();
            return;
        }

        setTimeout(() => {
            if (!waveAIHasSelection()) {
                model.focusInput();
            }
        }, 0);
    };

    const showBlockMask = isLayoutMode && showOverlayBlockNums;

    return (
        <div
            data-waveai-panel="true"
            className={cn(
                "bg-gray-900 flex flex-col relative h-[calc(100%-4px)] mt-1",
                className,
                isDragOver && "bg-gray-800 border-accent",
                isFocused ? "border-2 border-accent" : "border-2 border-transparent"
            )}
            style={{
                borderTopRightRadius: 10,
                borderBottomRightRadius: 10,
                borderBottomLeftRadius: 10,
            }}
            onFocusCapture={handleFocusCapture}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleClick}
            inert={!isPanelVisible ? true : undefined}
        >
            {isDragOver && (
                <div
                    key="drag-overlay"
                    className="absolute inset-0 bg-accent/20 border-2 border-dashed border-accent rounded-lg flex items-center justify-center z-10 p-4"
                >
                    <div className="text-accent text-center">
                        <i className="fa fa-upload text-3xl mb-2"></i>
                        <div className="text-lg font-semibold">Drop files here</div>
                        <div className="text-sm">Images, PDFs, and text/code files supported</div>
                    </div>
                </div>
            )}
            {showBlockMask && (
                <div
                    key="block-mask"
                    className="absolute top-0 left-0 right-0 bottom-0 border-1 border-transparent pointer-events-auto select-none p-0.5"
                    style={{
                        borderRadius: "var(--block-border-radius)",
                        zIndex: "var(--zindex-block-mask-inner)",
                    }}
                >
                    <div
                        className="w-full mt-[44px] h-[calc(100%-44px)] flex items-center justify-center"
                        style={{
                            backgroundColor: "rgb(from var(--block-bg-color) r g b / 50%)",
                        }}
                    >
                        <div className="font-bold opacity-70 mt-[-25%] text-[60px]">0</div>
                    </div>
                </div>
            )}
            <AIPanelHeader onClose={onClose} model={model} onClearChat={clearChat} />
            <AIRateLimitStrip />

            <div key="main-content" className="flex-1 flex flex-col min-h-0">
                {!telemetryEnabled ? (
                    <TelemetryRequiredMessage />
                ) : (
                    <>
                        <AIPanelMessages messages={messages} status={status} isLoadingChat={isLoadingChat} />
                        {errorMessage && (
                            <div className="px-4 py-2 text-red-400 bg-red-900/20 border-l-4 border-red-500 mx-2 mb-2 relative">
                                <button
                                    onClick={() => model.clearError()}
                                    className="absolute top-2 right-2 text-red-400 hover:text-red-300 cursor-pointer z-10"
                                    aria-label="Close error"
                                >
                                    <i className="fa fa-times text-sm"></i>
                                </button>
                                <div className="text-sm pr-6 max-h-[100px] overflow-y-auto">{errorMessage}</div>
                            </div>
                        )}
                        <AIDroppedFiles model={model} />
                        <AIPanelInput
                            ref={inputRef}
                            input={input}
                            setInput={setInput}
                            onSubmit={handleSubmit}
                            status={status}
                            model={model}
                        />
                    </>
                )}
            </div>
        </div>
    );
});

AIPanelComponentInner.displayName = "AIPanelInner";

const AIPanelComponent = ({ className, onClose }: AIPanelProps) => {
    return (
        <ErrorBoundary>
            <AIPanelComponentInner className={className} onClose={onClose} />
        </ErrorBoundary>
    );
};

AIPanelComponent.displayName = "AIPanel";

export { AIPanelComponent as AIPanel };
