// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribe } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms, WOS } from "@/store/global";
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
    builderStatusAtom = atom<BuilderStatusData>(null) as PrimitiveAtom<BuilderStatusData>;
    saveNeededAtom!: Atom<boolean>;
    focusElemRef: { current: HTMLInputElement | null } = { current: null };
    monacoEditorRef: { current: any | null } = { current: null };
    statusUnsubFn: (() => void) | null = null;
    appGoUpdateUnsubFn: (() => void) | null = null;
    initialized = false;

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

    async initialize() {
        if (this.initialized) return;
        this.initialized = true;

        const builderId = globalStore.get(atoms.builderId);
        if (!builderId) return;

        if (this.statusUnsubFn) {
            this.statusUnsubFn();
        }

        this.statusUnsubFn = waveEventSubscribe({
            eventType: "builderstatus",
            scope: WOS.makeORef("builder", builderId),
            handler: (event) => {
                const status: BuilderStatusData = event.data;
                const currentStatus = globalStore.get(this.builderStatusAtom);
                if (!currentStatus || !currentStatus.version || status.version > currentStatus.version) {
                    globalStore.set(this.builderStatusAtom, status);
                }
            },
        });

        try {
            const status = await RpcApi.GetBuilderStatusCommand(TabRpcClient, builderId);
            globalStore.set(this.builderStatusAtom, status);
        } catch (err) {
            console.error("Failed to load builder status:", err);
        }

        const appId = globalStore.get(atoms.builderAppId);
        await this.loadAppFile(appId);

        this.appGoUpdateUnsubFn = waveEventSubscribe({
            eventType: "waveapp:appgoupdated",
            scope: appId,
            handler: () => {
                this.loadAppFile(appId);
            },
        });
    }

    async startBuilder() {
        const builderId = globalStore.get(atoms.builderId);
        if (!builderId) return;

        try {
            await RpcApi.StartBuilderCommand(TabRpcClient, {
                builderid: builderId,
            });
        } catch (err) {
            console.error("Failed to start builder:", err);
            globalStore.set(this.errorAtom, `Failed to start builder: ${err.message || "Unknown error"}`);
        }
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

                if (decoded.trim() !== "") {
                    await this.startBuilder();
                }
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

    dispose() {
        if (this.statusUnsubFn) {
            this.statusUnsubFn();
            this.statusUnsubFn = null;
        }
        if (this.appGoUpdateUnsubFn) {
            this.appGoUpdateUnsubFn();
            this.appGoUpdateUnsubFn = null;
        }
    }
}
