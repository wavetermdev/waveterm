// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { cn } from "@/util/util";
import { useCallback, useEffect, useState } from "react";
import { inputHeightAtom, inputWidthAtom } from "../models/ui-model";
import { useAtom } from "jotai";
import { globalStore } from "@/app/store/jotaiStore";
import "./resizable-input.scss";

export interface ResizableInputProps {
    value: string;
    onChange: (value: string) => void;
    onSend: () => void;
    isSending?: boolean;
    disabled?: boolean;
    placeholder?: string;
    minHeight?: number;
    maxHeight?: number;
    minWidth?: number;
    maxWidth?: number;
    className?: string;
    showFileHint?: boolean;
}

const ResizableInput = React.memo(
    ({
        value,
        onChange,
        onSend,
        isSending = false,
        disabled = false,
        placeholder = "Type a message...",
        minHeight = 60,
        maxHeight = 400,
        minWidth = 300,
        maxWidth = 1200,
        className,
        showFileHint = true,
    }: ResizableInputProps) => {
        const [inputHeight, setInputHeight] = useAtom(inputHeightAtom);
        const [inputWidth, setInputWidth] = useAtom(inputWidthAtom);
        const textareaRef = React.useRef<HTMLTextAreaElement>(null);
        const containerRef = React.useRef<HTMLDivElement>(null);
        const [isResizing, setIsResizing] = useState(false);
        const resizeHandleRef = React.useRef<HTMLDivElement>(null);

        // Auto-resize height based on content
        const autoResizeHeight = useCallback(() => {
            if (textareaRef.current) {
                const newHeight = Math.max(
                    minHeight,
                    Math.min(
                        maxHeight,
                        Math.max(minHeight, textareaRef.current.scrollHeight)
                    )
                );

                // Only auto-resize if not currently being manually resized
                if (!isResizing) {
                    setInputHeight(newHeight);
                }
            }
        }, [minHeight, maxHeight, isResizing, setInputHeight]);

        // Sync atom value to local state and auto-resize
        useEffect(() => {
            if (textareaRef.current) {
                // Reset height to auto to calculate scrollHeight correctly
                textareaRef.current.style.height = "auto";
                autoResizeHeight();

                // Set the saved height from atom
                const savedHeight = globalStore.get(inputHeightAtom);
                if (savedHeight !== "auto" && typeof savedHeight === "number") {
                    textareaRef.current.style.height = `${savedHeight}px`;
                }
            }
        }, [value, autoResizeHeight, inputHeightAtom]);

        // Initial width sync
        useEffect(() => {
            const savedWidth = globalStore.get(inputWidthAtom);
            if (typeof savedWidth === "number" && containerRef.current) {
                containerRef.current.style.width = `${savedWidth}px`;
            }
        }, [inputWidthAtom]);

        const handleKeyDown = useCallback(
            (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    if (value.trim() && !isSending && !disabled) {
                        onSend();
                    }
                }
            },
            [value, isSending, disabled, onSend]
        );

        const handleFocus = useCallback(() => {
            // Could emit focus event if needed
        }, []);

        const handleBlur = useCallback(() => {
            // Could emit blur event if needed
        }, []);

        // Handle manual resize via drag handle
        const handleResizeStart = useCallback(
            (e: React.MouseEvent<HTMLDivElement>) => {
                e.preventDefault();
                setIsResizing(true);

                const startY = e.clientY;
                const startHeight = inputHeight === "auto" ? minHeight : inputHeight;
                const startX = e.clientX;
                const startWidth = typeof inputWidth === "number" ? inputWidth : 800;

                const handleMouseMove = (moveEvent: MouseEvent) => {
                    const deltaY = moveEvent.clientY - startY;
                    const deltaX = moveEvent.clientX - startX;

                    let newHeight = startHeight + deltaY;
                    let newWidth = startWidth + deltaX;

                    // Clamp to limits
                    newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
                    newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

                    setInputHeight(newHeight);
                    setInputWidth(newWidth);

                    if (textareaRef.current) {
                        textareaRef.current.style.height = `${newHeight}px`;
                    }
                    if (containerRef.current) {
                        containerRef.current.style.width = `${newWidth}px`;
                    }
                };

                const handleMouseUp = () => {
                    setIsResizing(false);
                    document.removeEventListener("mousemove", handleMouseMove);
                    document.removeEventListener("mouseup", handleMouseUp);
                };

                document.addEventListener("mousemove", handleMouseMove);
                document.addEventListener("mouseup", handleMouseUp);
            },
            [inputHeight, inputWidth, minHeight, maxHeight, minWidth, maxWidth, setInputHeight, setInputWidth]
        );

        const handleSend = useCallback(() => {
            if (value.trim() && !isSending && !disabled) {
                onSend();
            }
        }, [value, isSending, disabled, onSend]);

        const currentHeight = inputHeight === "auto" ? minHeight : inputHeight;
        const currentWidth = inputWidth === "auto" ? "auto" : inputWidth;

        return (
            <div
                ref={containerRef}
                className={cn("resizable-input-container", className, {
                    "is-resizing": isResizing,
                    "is-sending": isSending,
                    isDisabled: disabled,
                })}
                style={{
                    minHeight: `${minHeight}px`,
                    maxHeight: `${maxHeight}px`,
                    minWidth: `${minWidth}px`,
                    maxWidth: `${maxWidth}px`,
                    height: `${currentHeight}px`,
                    width: typeof currentWidth === "number" ? `${currentWidth}px` : currentWidth,
                }}
            >
                <div className="resizable-input-content">
                    <div className="input-wrapper">
                        <textarea
                            ref={textareaRef}
                            value={value}
                            onChange={(e) => onChange(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onFocus={handleFocus}
                            onBlur={handleBlur}
                            placeholder={placeholder}
                            disabled={disabled}
                            className="text-area-input"
                            style={{
                                minHeight: `${minHeight}px`,
                                maxHeight: `${maxHeight}px`,
                            }}
                            rows={1}
                        />
                    </div>

                    <div className="input-actions">
                        <button
                            type="button"
                            onClick={handleSend}
                            disabled={!value.trim() || isSending || disabled}
                            className={cn("send-button", {
                                "is-disabled": !value.trim() || isSending || disabled,
                            })}
                            aria-label="Send message"
                        >
                            {isSending ? (
                                <>
                                    <span className="sending-spinner">
                                        <i className="fa-solid fa-circle-notch fa-spin" />
                                    </span>
                                    <span>Sending...</span>
                                </>
                            ) : (
                                <>
                                    <span className="send-icon">
                                        <i className="fa-solid fa-paper-plane" />
                                    </span>
                                    <span>Send</span>
                                    <span className="shortcut-hint">Ctrl+Enter</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {showFileHint && (
                    <div className="file-hint">
                        <i className="fa-solid fa-paperclip" />
                        <span>Paste files or code to attach</span>
                    </div>
                )}

                {/* Resize handle */}
                <div
                    ref={resizeHandleRef}
                    className="resize-handle"
                    onMouseDown={handleResizeStart}
                    title="Drag to resize"
                >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path
                            d="M4 12L12 4M12 12V4M12 4H4"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                        />
                    </svg>
                </div>
            </div>
        );
    }
);

ResizableInput.displayName = "ResizableInput";

export default ResizableInput;
