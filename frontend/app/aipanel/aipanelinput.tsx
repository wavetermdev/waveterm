// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { formatFileSizeError, isAcceptableFile, validateFileSize } from "@/app/aipanel/ai-utils";
import { waveAIHasFocusWithin } from "@/app/aipanel/waveai-focus-utils";
import { type WaveAIModel } from "@/app/aipanel/waveai-model";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef } from "react";

interface AIPanelInputProps {
    onSubmit: (e: React.FormEvent) => void;
    status: string;
    model: WaveAIModel;
}

export interface AIPanelInputRef {
    focus: () => void;
    resize: () => void;
}

export const AIPanelInput = memo(({ onSubmit, status, model }: AIPanelInputProps) => {
    const [input, setInput] = useAtom(model.inputAtom);
    const isFocused = useAtomValue(model.isWaveAIFocusedAtom);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isPanelOpen = useAtomValue(model.getPanelVisibleAtom());

    const resizeTextarea = useCallback(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.style.height = "auto";
        const scrollHeight = textarea.scrollHeight;
        const maxHeight = 7 * 24;
        textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    }, []);

    useEffect(() => {
        const inputRefObject: React.RefObject<AIPanelInputRef> = {
            current: {
                focus: () => textareaRef.current?.focus(),
                resize: resizeTextarea,
            },
        };
        model.registerInputRef(inputRefObject);
    }, [model, resizeTextarea]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const isComposing = e.nativeEvent?.isComposing || e.keyCode == 229;
        if (e.key === "Enter" && !e.shiftKey && !isComposing) {
            e.preventDefault();
            onSubmit(e as any);
        }
    };

    const handleFocus = useCallback(() => model.requestWaveAIFocus(), [model]);

    const handleBlur = useCallback(
        (e: React.FocusEvent) => {
            if (e.relatedTarget === null) return;
            if (waveAIHasFocusWithin(e.relatedTarget)) return;
            model.requestNodeFocus();
        },
        [model]
    );

    useEffect(() => resizeTextarea(), [input, resizeTextarea]);
    useEffect(() => {
        if (isPanelOpen) resizeTextarea();
    }, [isPanelOpen, resizeTextarea]);

    const handleUploadClick = () => fileInputRef.current?.click();

    const processFile = useCallback(
        async (file: File) => {
            if (!isAcceptableFile(file)) {
                console.warn(`Rejected unsupported file type: ${file.type}`);
                return;
            }

            const sizeError = validateFileSize(file);
            if (sizeError) {
                model.setError(formatFileSizeError(sizeError));
                return;
            }

            try {
                await model.addFile(file);
            } catch (error: any) {
                console.error("Failed to add file:", error);
                model.setError(error?.message || "Failed to add file");
            }
        },
        [model]
    );

    const handleFileChange = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const files = Array.from(e.target.files || []);
            for (const file of files) await processFile(file);
            if (e.target) e.target.value = "";
        },
        [processFile]
    );

    const handlePaste = useCallback(
        async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
            const items = e.clipboardData?.items;
            if (!items) return;

            for (const item of items) {
                if (item.type.startsWith("image/")) {
                    const blob = item.getAsFile();
                    if (!blob) continue;

                    let ext = blob.type.split("/")[1] || "png";
                    ext = ext.toLowerCase();
                    if (ext === "jpeg") ext = "jpg";
                    if (!/^[a-z0-9]+$/.test(ext)) ext = "png";

                    const filename = `pasted-image-${Date.now()}.${ext}`;
                    const file = new File([blob], filename, { type: blob.type });

                    await processFile(file);
                }
            }
        },
        [processFile]
    );

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
                        onPaste={handlePaste}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        placeholder={model.inBuilder ? "What would you like to build..." : "Ask Wave AI anything..."}
                        className={cn(
                            "w-full text-white px-2 py-2 pr-5 focus:outline-none resize-none overflow-auto",
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
});

AIPanelInput.displayName = "AIPanelInput";
