// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getTabMetaKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
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
    private scrollToBottomCallback: (() => void) | null = null;

    widgetAccessAtom!: jotai.Atom<boolean>;
    droppedFiles: jotai.PrimitiveAtom<DroppedFile[]> = jotai.atom([]);
    chatId!: jotai.PrimitiveAtom<string>;
    errorMessage: jotai.PrimitiveAtom<string> = jotai.atom(null) as jotai.PrimitiveAtom<string>;
    modelAtom!: jotai.Atom<string>;
    containerWidth: jotai.PrimitiveAtom<number> = jotai.atom(0);
    codeBlockMaxWidth!: jotai.Atom<number>;
    inputAtom: jotai.PrimitiveAtom<string> = jotai.atom("");
    isChatEmpty: boolean = true;

    private constructor() {
        const tabId = globalStore.get(atoms.staticTabId);
        const chatIdMetaAtom = getTabMetaKeyAtom(tabId, "waveai:chatid");
        let chatIdValue = globalStore.get(chatIdMetaAtom);

        if (chatIdValue == null) {
            chatIdValue = crypto.randomUUID();
            RpcApi.SetMetaCommand(TabRpcClient, {
                oref: WOS.makeORef("tab", tabId),
                meta: { "waveai:chatid": chatIdValue },
            });
        }

        this.chatId = jotai.atom(chatIdValue);

        this.modelAtom = jotai.atom((get) => {
            const tabId = get(atoms.staticTabId);
            const modelMetaAtom = getTabMetaKeyAtom(tabId, "waveai:model");
            return get(modelMetaAtom) ?? "gpt-5";
        });

        this.widgetAccessAtom = jotai.atom((get) => {
            const tabId = get(atoms.staticTabId);
            const widgetAccessMetaAtom = getTabMetaKeyAtom(tabId, "waveai:widgetcontext");
            const value = get(widgetAccessMetaAtom);
            return value ?? true;
        });

        this.codeBlockMaxWidth = jotai.atom((get) => {
            const width = get(this.containerWidth);
            return width > 0 ? width - 35 : 0;
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
        this.isChatEmpty = true;
        const newChatId = crypto.randomUUID();
        globalStore.set(this.chatId, newChatId);

        const tabId = globalStore.get(atoms.staticTabId);
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("tab", tabId),
            meta: { "waveai:chatid": newChatId },
        });
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

    registerScrollToBottom(callback: () => void) {
        this.scrollToBottomCallback = callback;
    }

    scrollToBottom() {
        this.scrollToBottomCallback?.();
    }

    focusInput() {
        if (!WorkspaceLayoutModel.getInstance().getAIPanelVisible()) {
            WorkspaceLayoutModel.getInstance().setAIPanelVisible(true);
        }
        if (this.inputRef?.current) {
            this.inputRef.current.focus();
        }
    }

    hasNonEmptyInput(): boolean {
        const input = globalStore.get(this.inputAtom);
        return input != null && input.trim().length > 0;
    }

    setModel(model: string) {
        const tabId = globalStore.get(atoms.staticTabId);
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("tab", tabId),
            meta: { "waveai:model": model },
        });
    }

    setWidgetAccess(enabled: boolean) {
        const tabId = globalStore.get(atoms.staticTabId);
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("tab", tabId),
            meta: { "waveai:widgetcontext": enabled },
        });
    }

    async loadChat(): Promise<UIMessage[]> {
        const chatId = globalStore.get(this.chatId);
        try {
            const chatData = await RpcApi.GetWaveAIChatCommand(TabRpcClient, { chatid: chatId });
            const messages = chatData?.messages ?? [];
            this.isChatEmpty = messages.length === 0;
            return messages;
        } catch (error) {
            console.error("Failed to load chat:", error);
            this.setError("Failed to load chat. Starting new chat...");

            const newChatId = crypto.randomUUID();
            globalStore.set(this.chatId, newChatId);

            const tabId = globalStore.get(atoms.staticTabId);
            RpcApi.SetMetaCommand(TabRpcClient, {
                oref: WOS.makeORef("tab", tabId),
                meta: { "waveai:chatid": newChatId },
            });

            this.isChatEmpty = true;
            return [];
        }
    }

    async ensureRateLimitSet() {
        const currentInfo = globalStore.get(atoms.waveAIRateLimitInfoAtom);
        if (currentInfo != null) {
            return;
        }
        try {
            const rateLimitInfo = await RpcApi.GetWaveAIRateLimitCommand(TabRpcClient);
            if (rateLimitInfo != null) {
                globalStore.set(atoms.waveAIRateLimitInfoAtom, rateLimitInfo);
            }
        } catch (error) {
            console.error("Failed to fetch rate limit info:", error);
        }
    }
}
