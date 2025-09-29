// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { formatFileSizeError, isAcceptableFile, validateFileSize } from "@/app/aipanel/ai-utils";
import { type WaveAIModel } from "@/app/aipanel/waveai-model";
import { atoms, globalStore } from "@/app/store/global";
import { workspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef } from "react";

interface AIPanelInputProps {
    input: string;
    setInput: (value: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    status: string;
    model: WaveAIModel;
}

export interface AIPanelInputRef {
    focus: () => void;
    resize: () => void;
}

export const AIPanelInput = memo(
    forwardRef<AIPanelInputRef, AIPanelInputProps>(({ input, setInput, onSubmit, status, model }, ref) => {
        const isFocused = useAtomValue(atoms.waveAIFocusedAtom);
        const textareaRef = useRef<HTMLTextAreaElement>(null);
        const fileInputRef = useRef<HTMLInputElement>(null);
        const isPanelOpen = useAtomValue(workspaceLayoutModel.panelVisibleAtom);

        const resizeTextarea = useCallback(() => {
            const textarea = textareaRef.current;
            if (!textarea) return;

            textarea.style.height = "auto";
            const scrollHeight = textarea.scrollHeight;
            const maxHeight = 6 * 24;
            textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
        }, []);

        useImperativeHandle(ref, () => ({
            focus: () => {
                console.log("calling FOCUS", textareaRef.current);
                textareaRef.current?.focus();
            },
            resize: resizeTextarea,
        }));

        const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e as any);
            }
        };

        const handleFocus = useCallback(() => {
            globalStore.set(atoms.waveAIFocusedAtom, true);
        }, []);

        const handleBlur = useCallback(() => {
            globalStore.set(atoms.waveAIFocusedAtom, false);
        }, []);

        useEffect(() => {
            resizeTextarea();
        }, [input, resizeTextarea]);

        useEffect(() => {
            if (isPanelOpen) {
                resizeTextarea();
            }
        }, [isPanelOpen, resizeTextarea]);

        const handleUploadClick = () => {
            fileInputRef.current?.click();
        };

        const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            const files = Array.from(e.target.files || []);
            const acceptableFiles = files.filter(isAcceptableFile);

            for (const file of acceptableFiles) {
                const sizeError = validateFileSize(file);
                if (sizeError) {
                    model.setError(formatFileSizeError(sizeError));
                    if (e.target) {
                        e.target.value = "";
                    }
                    return;
                }
                model.addFile(file);
            }

            if (acceptableFiles.length < files.length) {
                console.warn(
                    `${files.length - acceptableFiles.length} files were rejected due to unsupported file types`
                );
            }

            if (e.target) {
                e.target.value = "";
            }
        };

        return (
            <div className={cn("border-t", isFocused ? "border-accent/50" : "border-gray-600")}>
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf,.txt,.md,.js,.jsx,.ts,.tsx,.go,.py,.java,.c,.cpp,.h,.hpp,.html,.css,.scss,.sass,.json,.xml,.yaml,.yml,.sh,.bat,.sql"
                    onChange={handleFileChange}
                    className="hidden"
                />
                <form onSubmit={onSubmit}>
                    <div className="relative">
                        <textarea
                            ref={textareaRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onFocus={handleFocus}
                            onBlur={handleBlur}
                            placeholder="Ask Wave AI anything..."
                            className={cn(
                                "w-full  text-white px-2 py-2 pr-12 focus:outline-none resize-none overflow-hidden",
                                isFocused ? "bg-accent-900/50" : "bg-gray-800"
                            )}
                            style={{ fontSize: "13px" }}
                            rows={2}
                        />
                        <button
                            type="button"
                            onClick={handleUploadClick}
                            className={cn(
                                "absolute bottom-6 right-1 w-3.5 h-3.5 transition-colors flex items-center justify-center text-gray-400 hover:text-accent cursor-pointer"
                            )}
                        >
                            <i className="fa fa-paperclip text-xs"></i>
                        </button>
                        <button
                            type="submit"
                            disabled={status !== "ready" || !input.trim()}
                            className={cn(
                                "absolute bottom-2 right-1 w-3.5 h-3.5 transition-colors flex items-center justify-center",
                                status !== "ready" || !input.trim()
                                    ? "text-gray-400"
                                    : "text-accent/80 hover:text-accent cursor-pointer"
                            )}
                        >
                            {status === "streaming" ? (
                                <i className="fa fa-spinner fa-spin text-xs"></i>
                            ) : (
                                <i className="fa fa-paper-plane text-xs"></i>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        );
    })
);

AIPanelInput.displayName = "AIPanelInput";
