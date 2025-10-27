// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";

export type TabType = "preview" | "files" | "code";

export class BuilderAppPanelModel {
    private static instance: BuilderAppPanelModel | null = null;

    activeTab: PrimitiveAtom<TabType> = atom<TabType>("preview");
    focusElemRef: { current: HTMLInputElement | null } = { current: null };

    private constructor() {}

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

    giveFocus() {
        this.focusElemRef.current?.focus();
    }

    setFocusElemRef(ref: HTMLInputElement | null) {
        this.focusElemRef.current = ref;
    }
}