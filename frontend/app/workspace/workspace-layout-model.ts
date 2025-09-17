// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isDev } from "@/store/global";
import { globalStore } from "@/store/jotaiStore";
import { atom, PrimitiveAtom } from "jotai";

const AI_PANEL_DEFAULT_WIDTH = 300;
const AI_PANEL_MIN_WIDTH = 250;

class WorkspaceLayoutModel {
    aiPanelVisibleAtom: PrimitiveAtom<boolean>;
    aiPanelWidthAtom: PrimitiveAtom<number>;

    constructor() {
        this.aiPanelVisibleAtom = atom(isDev());
        this.aiPanelWidthAtom = atom(AI_PANEL_DEFAULT_WIDTH);
    }

    getMaxAIPanelWidth(windowWidth: number): number {
        return Math.floor(windowWidth * 0.5);
    }

    getClampedAIPanelWidth(width: number, windowWidth: number): number {
        const maxWidth = this.getMaxAIPanelWidth(windowWidth);
        return Math.max(AI_PANEL_MIN_WIDTH, Math.min(width, maxWidth));
    }

    getAIPanelVisible(): boolean {
        return globalStore.get(this.aiPanelVisibleAtom);
    }

    setAIPanelVisible(visible: boolean): void {
        if (!isDev() && visible) {
            return;
        }
        globalStore.set(this.aiPanelVisibleAtom, visible);
    }

    getAIPanelWidth(): number {
        return globalStore.get(this.aiPanelWidthAtom);
    }

    setAIPanelWidth(width: number): void {
        globalStore.set(this.aiPanelWidthAtom, width);
    }

    handleAIPanelResize(width: number, windowWidth: number): void {
        if (!isDev()) {
            return;
        }
        const clampedWidth = this.getClampedAIPanelWidth(width, windowWidth);
        this.setAIPanelWidth(clampedWidth);

        if (!this.getAIPanelVisible()) {
            this.setAIPanelVisible(true);
        }
    }
}

const workspaceLayoutModel = new WorkspaceLayoutModel();

export { AI_PANEL_DEFAULT_WIDTH, AI_PANEL_MIN_WIDTH, workspaceLayoutModel, WorkspaceLayoutModel };
