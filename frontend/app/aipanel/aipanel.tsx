// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { handleWaveAIContextMenu } from "@/app/aipanel/aipanel-contextmenu";
import { waveAIHasSelection } from "@/app/aipanel/waveai-focus-utils";
import { ErrorBoundary } from "@/app/element/errorboundary";
import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import { isMacOS } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import * as jotai from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useDrop } from "react-dnd";
import { formatFileSizeError, isAcceptableFile, validateFileSize } from "./ai-utils";
import { AIDroppedFiles } from "./aidroppedfiles";
import { AIModeDropdown } from "./aimode";
import { AIPanelHeader } from "./aipanelheader";
import { AIPanelInput } from "./aipanelinput";
import { AIPanelMessages } from "./aipanelmessages";
import { AIRateLimitStrip } from "./airatelimitstrip";
import { TelemetryRequiredMessage } from "./telemetryrequired";
import { WaveAIModel } from "./waveai-model";

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
                    BETA: Free to use. Daily limits keep our costs in check.
                </div>
            </div>
        </div>
    );
});

AIWelcomeMessage.displayName = "AIWelcomeMessage";

const AIBuilderWelcomeMessage = memo(() => {
    return (
        <div className="text-secondary py-8">
            <div className="text-center">
                <i className="fa fa-sparkles text-4xl text-accent mb-4 block"></i>
                <p className="text-lg font-bold text-primary">WaveApp Builder</p>
            </div>
            <div className="mt-4 text-left max-w-md mx-auto">
                <p className="text-sm mb-6">
                    The WaveApp builder helps create wave widgets that integrate seamlessly into Wave Terminal.
                </p>
            </div>
        </div>
    );
});

AIBuilderWelcomeMessage.displayName = "AIBuilderWelcomeMessage";

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

const AIPanelComponentInner = memo(() => {
    const [isDragOver, setIsDragOver] = useState(false);
    const [isReactDndDragOver, setIsReactDndDragOver] = useState(false);
    const [initialLoadDone, setInitialLoadDone] = useState(false);
    const model = WaveAIModel.getInstance();
    const containerRef = useRef<HTMLDivElement>(null);
    const errorMessage = jotai.useAtomValue(model.errorMessage);
    const isLayoutMode = jotai.useAtomValue(atoms.controlShiftDelayAtom);
    const showOverlayBlockNums = jotai.useAtomValue(getSettingsKeyAtom("app:showoverlayblocknums")) ?? true;
    const isFocused = jotai.useAtomValue(model.isWaveAIFocusedAtom);
    const telemetryEnabled = jotai.useAtomValue(getSettingsKeyAtom("telemetry:enabled")) ?? false;
    const isPanelVisible = jotai.useAtomValue(model.getPanelVisibleAtom());

    const { messages, sendMessage, status, setMessages, error, stop } = useChat({
        transport: new DefaultChatTransport({
            api: model.getUseChatEndpointUrl(),
            prepareSendMessagesRequest: (opts) => {
                const msg = model.getAndClearMessage();
                const windowType = globalStore.get(atoms.waveWindowType);
                const body: any = {
                    msg,
                    chatid: globalStore.get(model.chatId),
                    widgetaccess: globalStore.get(model.widgetAccessAtom),
                };
                if (windowType === "builder") {
                    body.builderid = globalStore.get(atoms.builderId);
                    body.builderappid = globalStore.get(atoms.builderAppId);
                } else {
                    body.tabid = globalStore.get(atoms.staticTabId);
                }
                return { body };
            },
        }),
        onError: (error) => {
            console.error("AI Chat error:", error);
            model.setError(error.message || "An error occurred");
        },
    });

    model.registerUseChatData(sendMessage, setMessages, status, stop);

    // console.log("AICHAT messages", messages);
    (window as any).aichatmessages = messages;
    (window as any).aichatstatus = status;

    const handleKeyDown = (waveEvent: WaveKeyboardEvent): boolean => {
        if (checkKeyPressed(waveEvent, "Cmd:k")) {
            model.clearChat();
            return true;
        }
        return false;
    };

    useEffect(() => {
        globalStore.set(model.isAIStreaming, status == "streaming");
    }, [status]);

    useEffect(() => {
        const keyHandler = keydownWrapper(handleKeyDown);
        document.addEventListener("keydown", keyHandler);
        return () => {
            document.removeEventListener("keydown", keyHandler);
        };
    }, []);

    useEffect(() => {
        const loadChat = async () => {
            await model.uiLoadInitialChat();
            setInitialLoadDone(true);
        };
        loadChat();
    }, [model]);

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
        await model.handleSubmit();
        setTimeout(() => {
            model.focusInput();
        }, 100);
    };

    const hasFilesDragged = (dataTransfer: DataTransfer): boolean => {
        // Check if the drag operation contains files by looking at the types
        return dataTransfer.types.includes("Files");
    };

    const handleDragOver = (e: React.DragEvent) => {
        const hasFiles = hasFilesDragged(e.dataTransfer);

        // Only handle native file drags here, let react-dnd handle FILE_ITEM drags
        if (!hasFiles) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        if (!isDragOver) {
            setIsDragOver(true);
        }
    };

    const handleDragEnter = (e: React.DragEvent) => {
        const hasFiles = hasFilesDragged(e.dataTransfer);

        // Only handle native file drags here, let react-dnd handle FILE_ITEM drags
        if (!hasFiles) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        const hasFiles = hasFilesDragged(e.dataTransfer);

        // Only handle native file drags here, let react-dnd handle FILE_ITEM drags
        if (!hasFiles) {
            return;
        }

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
        // Check if this is a FILE_ITEM drag from react-dnd
        // If so, let react-dnd handle it instead
        if (!e.dataTransfer.files.length) {
            return; // Let react-dnd handle FILE_ITEM drags
        }

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

    const handleFileItemDrop = useCallback(
        (draggedFile: DraggedFile) => model.addFileFromRemoteUri(draggedFile),
        [model]
    );

    const [{ isOver, canDrop }, drop] = useDrop(
        () => ({
            accept: "FILE_ITEM",
            drop: handleFileItemDrop,
            collect: (monitor) => ({
                isOver: monitor.isOver(),
                canDrop: monitor.canDrop(),
            }),
        }),
        [handleFileItemDrop]
    );

    // Update drag over state for FILE_ITEM drags
    useEffect(() => {
        if (isOver && canDrop) {
            setIsReactDndDragOver(true);
        } else {
            setIsReactDndDragOver(false);
        }
    }, [isOver, canDrop]);

    // Attach the drop ref to the container
    useEffect(() => {
        if (containerRef.current) {
            drop(containerRef.current);
        }
    }, [drop]);

    const handleFocusCapture = useCallback(
        (event: React.FocusEvent) => {
            // console.log("Wave AI focus capture", getElemAsStr(event.target));
            model.requestWaveAIFocus();
        },
        [model]
    );

    const handleClick = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        const isInteractive = target.closest('button, a, input, textarea, select, [role="button"], [tabindex]');

        if (isInteractive) {
            return;
        }

        const hasSelection = waveAIHasSelection();
        if (hasSelection) {
            model.requestWaveAIFocus();
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
            ref={containerRef}
            data-waveai-panel="true"
            className={cn(
                "@container bg-gray-900 flex flex-col relative",
                model.inBuilder ? "mt-0 h-full" : "mt-1 h-[calc(100%-4px)]",
                (isDragOver || isReactDndDragOver) && "bg-gray-800 border-accent",
                isFocused ? "border-2 border-accent" : "border-2 border-transparent"
            )}
            style={{
                borderTopRightRadius: model.inBuilder ? 0 : 10,
                borderBottomRightRadius: model.inBuilder ? 0 : 10,
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
            {(isDragOver || isReactDndDragOver) && <AIDragOverlay />}
            {showBlockMask && <AIBlockMask />}
            <AIPanelHeader />
            <AIRateLimitStrip />

            <div key="main-content" className="flex-1 flex flex-col min-h-0">
                {!telemetryEnabled ? (
                    <TelemetryRequiredMessage />
                ) : (
                    <>
                        {messages.length === 0 && initialLoadDone ? (
                            <div
                                className="flex-1 overflow-y-auto p-2 relative"
                                onContextMenu={(e) => handleWaveAIContextMenu(e, true)}
                            >
                                <div className="absolute top-2 left-2 z-10">
                                    <AIModeDropdown />
                                </div>
                                {model.inBuilder ? <AIBuilderWelcomeMessage /> : <AIWelcomeMessage />}
                            </div>
                        ) : (
                            <AIPanelMessages
                                messages={messages}
                                status={status}
                                onContextMenu={(e) => handleWaveAIContextMenu(e, true)}
                            />
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

const AIPanelComponent = () => {
    return (
        <ErrorBoundary>
            <AIPanelComponentInner />
        </ErrorBoundary>
    );
};

AIPanelComponent.displayName = "AIPanel";

export { AIPanelComponent as AIPanel };
