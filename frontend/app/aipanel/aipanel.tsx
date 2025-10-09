// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveUIMessagePart } from "@/app/aipanel/aitypes";
import { waveAIHasSelection } from "@/app/aipanel/waveai-focus-utils";
import { ErrorBoundary } from "@/app/element/errorboundary";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { focusManager } from "@/app/store/focusManager";
import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { getWebServerEndpoint } from "@/util/endpoints";
import { checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import { isMacOS } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import * as jotai from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createDataUrl, formatFileSizeError, isAcceptableFile, normalizeMimeType, validateFileSize } from "./ai-utils";
import { AIDroppedFiles } from "./aidroppedfiles";
import { AIPanelHeader } from "./aipanelheader";
import { AIPanelInput } from "./aipanelinput";
import { AIPanelMessages } from "./aipanelmessages";
import { AIRateLimitStrip } from "./airatelimitstrip";
import { TelemetryRequiredMessage } from "./telemetryrequired";
import { WaveAIModel, type DroppedFile } from "./waveai-model";

const AIBlockMask = memo(() => {
    return (
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
    );
});

AIBlockMask.displayName = "AIBlockMask";

const AIDragOverlay = memo(() => {
    return (
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
    );
});

AIDragOverlay.displayName = "AIDragOverlay";

const KeyCap = memo(({ children, className }: { children: React.ReactNode; className?: string }) => {
    return (
        <kbd
            className={cn(
                "px-1.5 py-0.5 text-xs bg-gray-700 border border-gray-600 rounded-sm shadow-sm font-mono",
                className
            )}
        >
            {children}
        </kbd>
    );
});

KeyCap.displayName = "KeyCap";

const AIWelcomeMessage = memo(() => {
    const modKey = isMacOS() ? "⌘" : "Alt";
    return (
        <div className="text-secondary py-8">
            <div className="text-center">
                <i className="fa fa-sparkles text-4xl text-accent mb-4 block"></i>
                <p className="text-lg font-bold text-primary">Welcome to Wave AI</p>
            </div>
            <div className="mt-4 text-left max-w-md mx-auto">
                <p className="text-sm mb-6">
                    Wave AI is your terminal assistant with context. I can read your terminal output, analyze widgets,
                    access files, and help you solve problems faster.
                </p>
                <div className="bg-accent/10 border border-accent/30 rounded-lg p-4">
                    <div className="text-sm font-semibold mb-3 text-accent">Getting Started:</div>
                    <div className="space-y-3 text-sm">
                        <div className="flex items-start gap-3">
                            <div className="w-4 text-center flex-shrink-0">
                                <i className="fa-solid fa-plug text-accent"></i>
                            </div>
                            <div>
                                <span className="font-bold">Widget Context</span>
                                <div className="">When ON, I can read your terminal and analyze widgets.</div>
                                <div className="">When OFF, I'm sandboxed with no system access.</div>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="w-4 text-center flex-shrink-0">
                                <i className="fa-solid fa-file-import text-accent"></i>
                            </div>
                            <div>Drag & drop files or images for analysis</div>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="w-4 text-center flex-shrink-0">
                                <i className="fa-solid fa-keyboard text-accent"></i>
                            </div>
                            <div className="space-y-1">
                                <div>
                                    <KeyCap>{modKey}</KeyCap>
                                    <KeyCap className="ml-1">K</KeyCap>
                                    <span className="ml-1.5">to start a new chat</span>
                                </div>
                                <div>
                                    <KeyCap>{modKey}</KeyCap>
                                    <KeyCap className="ml-1">Shift</KeyCap>
                                    <KeyCap className="ml-1">A</KeyCap>
                                    <span className="ml-1.5">to toggle panel</span>
                                </div>
                                <div>
                                    <KeyCap>Ctrl</KeyCap>
                                    <KeyCap className="ml-1">Shift</KeyCap>
                                    <KeyCap className="ml-1">0</KeyCap>
                                    <span className="ml-1.5">to focus</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="w-4 text-center flex-shrink-0">
                                <i className="fa-brands fa-discord text-accent"></i>
                            </div>
                            <div>
                                Questions or feedback?{" "}
                                <a
                                    target="_blank"
                                    href="https://discord.gg/XfvZ334gwU"
                                    rel="noopener"
                                    className="text-accent hover:underline cursor-pointer"
                                >
                                    Join our Discord
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="mt-4 text-center text-[12px] text-muted">
                    <i className="fa-sharp fa-solid fa-rectangle-beta mr-1.5"></i>(BETA: 50 free requests daily)
                </div>
            </div>
        </div>
    );
});

AIWelcomeMessage.displayName = "AIWelcomeMessage";

interface AIErrorMessageProps {
    errorMessage: string;
    onClear: () => void;
}

const AIErrorMessage = memo(({ errorMessage, onClear }: AIErrorMessageProps) => {
    return (
        <div className="px-4 py-2 text-red-400 bg-red-900/20 border-l-4 border-red-500 mx-2 mb-2 relative">
            <button
                onClick={onClear}
                className="absolute top-2 right-2 text-red-400 hover:text-red-300 cursor-pointer z-10"
                aria-label="Close error"
            >
                <i className="fa fa-times text-sm"></i>
            </button>
            <div className="text-sm pr-6 max-h-[100px] overflow-y-auto">{errorMessage}</div>
        </div>
    );
});

AIErrorMessage.displayName = "AIErrorMessage";

interface AIPanelProps {
    className?: string;
    onClose?: () => void;
}

const AIPanelComponentInner = memo(({ className, onClose }: AIPanelProps) => {
    const [isDragOver, setIsDragOver] = useState(false);
    const [isLoadingChat, setIsLoadingChat] = useState(true);
    const model = WaveAIModel.getInstance();
    const containerRef = useRef<HTMLDivElement>(null);
    const errorMessage = jotai.useAtomValue(model.errorMessage);
    const realMessageRef = useRef<AIMessage>(null);
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
        const loadMessages = async () => {
            const messages = await model.loadChat();
            setMessages(messages as any);
            setIsLoadingChat(false);
            setTimeout(() => {
                model.scrollToBottom();
            }, 100);
        };
        loadMessages();
    }, [model, setMessages]);

    useEffect(() => {
        const updateWidth = () => {
            if (containerRef.current) {
                globalStore.set(model.containerWidth, containerRef.current.offsetWidth);
            }
        };

        updateWidth();

        const resizeObserver = new ResizeObserver(updateWidth);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [model]);

    useEffect(() => {
        model.ensureRateLimitSet();
    }, [model]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const input = globalStore.get(model.inputAtom);
        if (!input.trim() || status !== "ready" || isLoadingChat) return;

        if (input.trim() === "/clear" || input.trim() === "/new") {
            clearChat();
            globalStore.set(model.inputAtom, "");
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

        globalStore.set(model.inputAtom, "");
        model.clearFiles();

        setTimeout(() => {
            model.focusInput();
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

    const handleMessagesContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const menu: ContextMenuItem[] = [];

        const hasSelection = waveAIHasSelection();
        if (hasSelection) {
            menu.push({
                role: "copy",
            });
            menu.push({ type: "separator" });
        }

        menu.push({
            label: "New Chat",
            click: () => {
                clearChat();
            },
        });

        menu.push({ type: "separator" });

        menu.push({
            label: "Hide Wave AI",
            click: () => {
                onClose?.();
            },
        });

        ContextMenuModel.showContextMenu(menu, e);
    };

    const showBlockMask = isLayoutMode && showOverlayBlockNums;

    return (
        <div
            ref={containerRef}
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
            {isDragOver && <AIDragOverlay />}
            {showBlockMask && <AIBlockMask />}
            <AIPanelHeader onClose={onClose} model={model} onClearChat={clearChat} />
            <AIRateLimitStrip />

            <div key="main-content" className="flex-1 flex flex-col min-h-0">
                {!telemetryEnabled ? (
                    <TelemetryRequiredMessage />
                ) : (
                    <>
                        {messages.length === 0 && !isLoadingChat ? (
                            <div className="flex-1 overflow-y-auto p-2" onContextMenu={handleMessagesContextMenu}>
                                <AIWelcomeMessage />
                            </div>
                        ) : (
                            <div className="flex-1 min-h-0" onContextMenu={handleMessagesContextMenu}>
                                <AIPanelMessages messages={messages} status={status} />
                            </div>
                        )}
                        {errorMessage && (
                            <AIErrorMessage errorMessage={errorMessage} onClear={() => model.clearError()} />
                        )}
                        <AIDroppedFiles model={model} />
                        <AIPanelInput onSubmit={handleSubmit} status={status} model={model} />
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
