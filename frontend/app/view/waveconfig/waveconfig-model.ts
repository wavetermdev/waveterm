// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WaveConfigView } from "@/app/view/waveconfig/waveconfig";
import { base64ToString, stringToBase64 } from "@/util/util";
import { atom, type PrimitiveAtom } from "jotai";
import type * as MonacoTypes from "monaco-editor/esm/vs/editor/editor.api";
import * as React from "react";

export type ConfigFile = {
    name: string;
    path: string;
    language: string;
    deprecated?: boolean;
};

const configFiles: ConfigFile[] = [
    { name: "General", path: "settings.json", language: "json" },
    { name: "Connections", path: "connections.json", language: "json" },
    { name: "Widgets", path: "widgets.json", language: "json" },
];

const deprecatedConfigFiles: ConfigFile[] = [
    { name: "AI Presets", path: "presets/ai.json", language: "json", deprecated: true },
];

export class WaveConfigViewModel implements ViewModel {
    blockId: string;
    viewType = "waveconfig";
    viewIcon = atom("gear");
    viewName = atom("Wave Config");
    viewComponent = WaveConfigView;
    nodeModel: BlockNodeModel;

    selectedFileAtom: PrimitiveAtom<ConfigFile>;
    fileContentAtom: PrimitiveAtom<string>;
    originalContentAtom: PrimitiveAtom<string>;
    isLoadingAtom: PrimitiveAtom<boolean>;
    isSavingAtom: PrimitiveAtom<boolean>;
    errorMessageAtom: PrimitiveAtom<string>;
    validationErrorAtom: PrimitiveAtom<string>;
    configDir: string;
    saveShortcut: string;
    editorRef: React.RefObject<MonacoTypes.editor.IStandaloneCodeEditor>;

    constructor(blockId: string, nodeModel: BlockNodeModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.configDir = getApi().getConfigDir();
        const platform = getApi().getPlatform();
        this.saveShortcut = platform === "darwin" ? "Cmd+S" : "Alt+S";

        this.selectedFileAtom = atom(null) as PrimitiveAtom<ConfigFile>;
        this.fileContentAtom = atom("");
        this.originalContentAtom = atom("");
        this.isLoadingAtom = atom(false);
        this.isSavingAtom = atom(false);
        this.errorMessageAtom = atom(null) as PrimitiveAtom<string>;
        this.validationErrorAtom = atom(null) as PrimitiveAtom<string>;
        this.editorRef = React.createRef();

        this.initialize();
    }

    initialize() {
        const selectedFile = globalStore.get(this.selectedFileAtom);
        if (!selectedFile && configFiles.length > 0) {
            this.loadFile(configFiles[0]);
        }
    }

    getConfigFiles(): ConfigFile[] {
        return configFiles;
    }

    getDeprecatedConfigFiles(): ConfigFile[] {
        return deprecatedConfigFiles;
    }

    hasChanges(): boolean {
        const fileContent = globalStore.get(this.fileContentAtom);
        const originalContent = globalStore.get(this.originalContentAtom);
        return fileContent !== originalContent;
    }

    async loadFile(file: ConfigFile) {
        globalStore.set(this.isLoadingAtom, true);
        globalStore.set(this.errorMessageAtom, null);
        try {
            const fullPath = `${this.configDir}/${file.path}`;
            const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
                info: { path: fullPath },
            });
            const content = fileData?.data64 ? base64ToString(fileData.data64) : "";
            globalStore.set(this.originalContentAtom, content);
            if (content.trim() === "") {
                globalStore.set(this.fileContentAtom, "{\n\n}");
            } else {
                globalStore.set(this.fileContentAtom, content);
            }
            globalStore.set(this.selectedFileAtom, file);
        } catch (err) {
            globalStore.set(this.errorMessageAtom, `Failed to load ${file.name}: ${err.message || String(err)}`);
            globalStore.set(this.fileContentAtom, "");
            globalStore.set(this.originalContentAtom, "");
        } finally {
            globalStore.set(this.isLoadingAtom, false);
        }
    }

    async saveFile() {
        const selectedFile = globalStore.get(this.selectedFileAtom);
        if (!selectedFile) return;

        const fileContent = globalStore.get(this.fileContentAtom);

        try {
            const parsed = JSON.parse(fileContent);
            const formatted = JSON.stringify(parsed, null, 2);

            globalStore.set(this.isSavingAtom, true);
            globalStore.set(this.errorMessageAtom, null);
            globalStore.set(this.validationErrorAtom, null);

            try {
                const fullPath = `${this.configDir}/${selectedFile.path}`;
                await RpcApi.FileWriteCommand(TabRpcClient, {
                    info: { path: fullPath },
                    data64: stringToBase64(formatted),
                });
                globalStore.set(this.fileContentAtom, formatted);
                globalStore.set(this.originalContentAtom, formatted);
            } catch (err) {
                globalStore.set(
                    this.errorMessageAtom,
                    `Failed to save ${selectedFile.name}: ${err.message || String(err)}`
                );
            } finally {
                globalStore.set(this.isSavingAtom, false);
            }
        } catch (err) {
            globalStore.set(this.validationErrorAtom, `Invalid JSON: ${err.message || String(err)}`);
        }
    }

    clearError() {
        globalStore.set(this.errorMessageAtom, null);
    }

    clearValidationError() {
        globalStore.set(this.validationErrorAtom, null);
    }

    giveFocus(): boolean {
        if (this.editorRef?.current) {
            this.editorRef.current.focus();
            return true;
        }
        return false;
    }
}
