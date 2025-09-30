// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getTabMetaKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { workspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { atoms } from "@/store/global";
import * as jotai from "jotai";
import type React from "react";
import { createImagePreview, resizeImage } from "./ai-utils";
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
    errorMessage: jotai.PrimitiveAtom<string> = jotai.atom(null) as jotai.PrimitiveAtom<string>;
    modelAtom!: jotai.Atom<string>;

    private constructor() {
        this.modelAtom = jotai.atom((get) => {
            const tabId = get(atoms.staticTabId);
            const modelMetaAtom = getTabMetaKeyAtom(tabId, "waveai:model");
            return get(modelMetaAtom) ?? "gpt-5";
        });
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

    async addFile(file: File): Promise<DroppedFile> {
        // Resize images before storing
        const processedFile = await resizeImage(file);

        const droppedFile: DroppedFile = {
            id: crypto.randomUUID(),
            file: processedFile,
            name: processedFile.name,
            type: processedFile.type,
            size: processedFile.size,
        };

        // Create 128x128 preview data URL for images
        if (processedFile.type.startsWith("image/")) {
            const previewDataUrl = await createImagePreview(processedFile);
            if (previewDataUrl) {
                droppedFile.previewUrl = previewDataUrl;
            }
        }

        const currentFiles = globalStore.get(this.droppedFiles);
        globalStore.set(this.droppedFiles, [...currentFiles, droppedFile]);

        return droppedFile;
    }

    removeFile(fileId: string) {
        const currentFiles = globalStore.get(this.droppedFiles);
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

    setError(message: string) {
        globalStore.set(this.errorMessage, message);
    }

    clearError() {
        globalStore.set(this.errorMessage, null);
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

    setModel(model: string) {
        const tabId = globalStore.get(atoms.staticTabId);
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("tab", tabId),
            meta: { "waveai:model": model },
        });
    }
}

// Export singleton instance for easy access
export const waveAIModel = WaveAIModel.getInstance();
