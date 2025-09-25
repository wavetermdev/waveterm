// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { workspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import * as jotai from "jotai";
import type React from "react";
import type { AIPanelInputRef } from "./aipanelinput";

export interface DroppedFile {
    id: string;
    file: File;
    name: string;
    type: string;
    size: number;
    previewUrl?: string;
}

export class WaveAIModel {
    private static instance: WaveAIModel | null = null;
    private inputRef: React.RefObject<AIPanelInputRef> | null = null;

    widgetAccess: jotai.PrimitiveAtom<boolean> = jotai.atom(true);
    droppedFiles: jotai.PrimitiveAtom<DroppedFile[]> = jotai.atom([]);
    chatId: jotai.PrimitiveAtom<string> = jotai.atom(crypto.randomUUID());

    private constructor() {
        // Private constructor prevents direct instantiation
    }

    static getInstance(): WaveAIModel {
        if (!WaveAIModel.instance) {
            WaveAIModel.instance = new WaveAIModel();
        }
        return WaveAIModel.instance;
    }

    static resetInstance(): void {
        WaveAIModel.instance = null;
    }

    addFile(file: File): DroppedFile {
        const droppedFile: DroppedFile = {
            id: crypto.randomUUID(),
            file,
            name: file.name,
            type: file.type,
            size: file.size,
        };

        // Create preview URL for images
        if (file.type.startsWith("image/")) {
            droppedFile.previewUrl = URL.createObjectURL(file);
        }

        const currentFiles = globalStore.get(this.droppedFiles);
        globalStore.set(this.droppedFiles, [...currentFiles, droppedFile]);

        return droppedFile;
    }

    removeFile(fileId: string) {
        const currentFiles = globalStore.get(this.droppedFiles);
        const fileToRemove = currentFiles.find((f) => f.id === fileId);

        // Cleanup preview URL if it exists
        if (fileToRemove?.previewUrl) {
            URL.revokeObjectURL(fileToRemove.previewUrl);
        }

        const updatedFiles = currentFiles.filter((f) => f.id !== fileId);
        globalStore.set(this.droppedFiles, updatedFiles);
    }

    clearFiles() {
        const currentFiles = globalStore.get(this.droppedFiles);

        // Cleanup all preview URLs
        currentFiles.forEach((file) => {
            if (file.previewUrl) {
                URL.revokeObjectURL(file.previewUrl);
            }
        });

        globalStore.set(this.droppedFiles, []);
    }

    clearChat() {
        this.clearFiles();
        globalStore.set(this.chatId, crypto.randomUUID());
    }

    registerInputRef(ref: React.RefObject<AIPanelInputRef>) {
        this.inputRef = ref;
    }

    focusInput() {
        if (!workspaceLayoutModel.getAIPanelVisible()) {
            workspaceLayoutModel.setAIPanelVisible(true);
        }
        if (this.inputRef?.current) {
            this.inputRef.current.focus();
        }
    }
}

// Export singleton instance for easy access
export const waveAIModel = WaveAIModel.getInstance();
