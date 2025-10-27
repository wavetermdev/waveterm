// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { base64ToString, stringToBase64 } from "@/util/util";
import { atom, type Atom, type PrimitiveAtom } from "jotai";

export type TabType = "preview" | "files" | "code";

export class BuilderAppPanelModel {
    private static instance: BuilderAppPanelModel | null = null;

    activeTab: PrimitiveAtom<TabType> = atom<TabType>("preview");
    codeContentAtom: PrimitiveAtom<string> = atom<string>("");
    originalContentAtom: PrimitiveAtom<string> = atom<string>("");
    isLoadingAtom: PrimitiveAtom<boolean> = atom<boolean>(false);
    errorAtom: PrimitiveAtom<string> = atom<string>("");
    saveNeededAtom!: Atom<boolean>;
    focusElemRef: { current: HTMLInputElement | null } = { current: null };
    monacoEditorRef: { current: any | null } = { current: null };

    private constructor() {
        this.saveNeededAtom = atom((get) => {
            return get(this.codeContentAtom) !== get(this.originalContentAtom);
        });
    }

    static getInstance(): BuilderAppPanelModel {
        if (!BuilderAppPanelModel.instance) {
            BuilderAppPanelModel.instance = new BuilderAppPanelModel();
        }
        return BuilderAppPanelModel.instance;
    }

    setActiveTab(tab: TabType) {
        globalStore.set(this.activeTab, tab);
    }

    getActiveTab(): TabType {
        return globalStore.get(this.activeTab);
    }

    setCodeContent(content: string) {
        globalStore.set(this.codeContentAtom, content);
    }

    async loadAppFile(appId: string) {
        if (!appId) {
            globalStore.set(this.errorAtom, "No app selected");
            globalStore.set(this.isLoadingAtom, false);
            return;
        }

        try {
            globalStore.set(this.isLoadingAtom, true);
            globalStore.set(this.errorAtom, "");
            const result = await RpcApi.ReadAppFileCommand(TabRpcClient, {
                appid: appId,
                filename: "app.go",
            });
            if (result.notfound) {
                globalStore.set(this.codeContentAtom, "");
                globalStore.set(this.originalContentAtom, "");
            } else {
                const decoded = base64ToString(result.data64);
                globalStore.set(this.codeContentAtom, decoded);
                globalStore.set(this.originalContentAtom, decoded);
            }
        } catch (err) {
            console.error("Failed to load app.go:", err);
            globalStore.set(this.errorAtom, `Failed to load app.go: ${err.message || "Unknown error"}`);
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    async saveAppFile(appId: string) {
        if (!appId) return;

        try {
            const content = globalStore.get(this.codeContentAtom);
            const encoded = stringToBase64(content);
            await RpcApi.WriteAppFileCommand(TabRpcClient, {
                appid: appId,
                filename: "app.go",
                data64: encoded,
            });
            globalStore.set(this.originalContentAtom, content);
            globalStore.set(this.errorAtom, "");
        } catch (err) {
            console.error("Failed to save app.go:", err);
            globalStore.set(this.errorAtom, `Failed to save app.go: ${err.message || "Unknown error"}`);
        }
    }

    giveFocus() {
        const activeTab = globalStore.get(this.activeTab);
        if (activeTab === "code" && this.monacoEditorRef.current) {
            this.monacoEditorRef.current.focus();
        } else {
            this.focusElemRef.current?.focus();
        }
    }

    setFocusElemRef(ref: HTMLInputElement | null) {
        this.focusElemRef.current = ref;
    }

    setMonacoEditorRef(ref: any) {
        this.monacoEditorRef.current = ref;
    }
}
