// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isDev } from "@/store/global";
import { ImperativePanelHandle } from "react-resizable-panels";

const AI_PANEL_DEFAULT_WIDTH = 300;
const AI_PANEL_MIN_WIDTH = 250;

class WorkspaceLayoutModel {
    aiPanelVisible: boolean;
    aiPanelRef: ImperativePanelHandle | null;
    aiPanelWidth: number;

    constructor() {
        this.aiPanelVisible = isDev();
        this.aiPanelRef = null;
        this.aiPanelWidth = AI_PANEL_DEFAULT_WIDTH;
    }

    registerAIPanelRef(ref: ImperativePanelHandle): void {
        this.aiPanelRef = ref;
        this.syncAIPanelRef();
    }

    syncAIPanelRef(): void {
        if (!this.aiPanelRef) {
            return;
        }
        if (this.aiPanelVisible) {
            this.aiPanelRef.expand();
        } else {
            this.aiPanelRef.collapse();
        }
    }

    getMaxAIPanelWidth(windowWidth: number): number {
        return Math.floor(windowWidth * 0.5);
    }

    getClampedAIPanelWidth(width: number, windowWidth: number): number {
        const maxWidth = this.getMaxAIPanelWidth(windowWidth);
        if (AI_PANEL_MIN_WIDTH > maxWidth) {
            return AI_PANEL_MIN_WIDTH;
        }
        return Math.max(AI_PANEL_MIN_WIDTH, Math.min(width, maxWidth));
    }

    getAIPanelVisible(): boolean {
        return this.aiPanelVisible;
    }

    setAIPanelVisible(visible: boolean): void {
        if (!isDev() && visible) {
            return;
        }
        this.aiPanelVisible = visible;
        this.syncAIPanelRef();
    }

    getAIPanelWidth(): number {
        return this.aiPanelWidth;
    }

    setAIPanelWidth(width: number): void {
        this.aiPanelWidth = width;
    }

    getAIPanelPercentage(windowWidth: number): number {
        const isVisible = this.getAIPanelVisible();
        if (!isVisible) {
            return 0;
        }
        const aiPanelWidth = this.getAIPanelWidth();
        const clampedWidth = this.getClampedAIPanelWidth(aiPanelWidth, windowWidth);
        const percentage = (clampedWidth / windowWidth) * 100;
        return Math.max(0, Math.min(percentage, 100));
    }

    getMainContentPercentage(windowWidth: number): number {
        const aiPanelPercentage = this.getAIPanelPercentage(windowWidth);
        return Math.max(0, 100 - aiPanelPercentage);
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
