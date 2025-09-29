// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getTabMetaKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms, isDev } from "@/store/global";
import * as jotai from "jotai";
import { debounce } from "lodash-es";
import { ImperativePanelGroupHandle, ImperativePanelHandle } from "react-resizable-panels";

const AIPANEL_DEFAULTWIDTH = 300;
const AIPANEL_MINWIDTH = 250;
const AIPANEL_MAXWIDTHRATIO = 0.5;

class WorkspaceLayoutModel {
    aiPanelRef: ImperativePanelHandle | null;
    panelGroupRef: ImperativePanelGroupHandle | null;
    inResize: boolean;
    private aiPanelVisible: boolean;
    private aiPanelWidth: number | null;
    private debouncedPersistWidth: (width: number) => void;
    private initialized: boolean = false;
    panelVisibleAtom: jotai.PrimitiveAtom<boolean>;

    constructor() {
        this.aiPanelRef = null;
        this.panelGroupRef = null;
        this.inResize = false;
        this.aiPanelVisible = isDev();
        this.aiPanelWidth = null;
        this.panelVisibleAtom = jotai.atom(this.aiPanelVisible);

        this.debouncedPersistWidth = debounce((width: number) => {
            try {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("tab", this.getTabId()),
                    meta: { "waveai:panelwidth": width },
                });
            } catch (e) {
                console.warn("Failed to persist panel width:", e);
            }
        }, 300);
    }

    private initializeFromTabMeta(): void {
        if (this.initialized) return;
        this.initialized = true;

        try {
            const savedVisible = globalStore.get(this.getPanelOpenAtom());
            const savedWidth = globalStore.get(this.getPanelWidthAtom());

            if (savedVisible != null) {
                this.aiPanelVisible = savedVisible;
                globalStore.set(this.panelVisibleAtom, savedVisible);
            }
            if (savedWidth != null) {
                this.aiPanelWidth = savedWidth;
            }
        } catch (e) {
            console.warn("Failed to initialize from tab meta:", e);
        }
    }

    private getTabId(): string {
        return globalStore.get(atoms.staticTabId);
    }

    private getPanelOpenAtom(): jotai.Atom<boolean> {
        return getTabMetaKeyAtom(this.getTabId(), "waveai:panelopen");
    }

    private getPanelWidthAtom(): jotai.Atom<number> {
        return getTabMetaKeyAtom(this.getTabId(), "waveai:panelwidth");
    }

    registerRefs(aiPanelRef: ImperativePanelHandle, panelGroupRef: ImperativePanelGroupHandle): void {
        this.aiPanelRef = aiPanelRef;
        this.panelGroupRef = panelGroupRef;
        this.syncAIPanelRef();
    }

    syncAIPanelRef(): void {
        if (!this.aiPanelRef || !this.panelGroupRef) {
            return;
        }

        const currentWindowWidth = window.innerWidth;
        const aiPanelPercentage = this.getAIPanelPercentage(currentWindowWidth);
        const mainContentPercentage = this.getMainContentPercentage(currentWindowWidth);

        if (this.getAIPanelVisible()) {
            this.aiPanelRef.expand();
        } else {
            this.aiPanelRef.collapse();
        }

        this.inResize = true;
        const layout = [aiPanelPercentage, mainContentPercentage];
        this.panelGroupRef.setLayout(layout);
        this.inResize = false;
    }

    getMaxAIPanelWidth(windowWidth: number): number {
        return Math.floor(windowWidth * AIPANEL_MAXWIDTHRATIO);
    }

    getClampedAIPanelWidth(width: number, windowWidth: number): number {
        const maxWidth = this.getMaxAIPanelWidth(windowWidth);
        if (AIPANEL_MINWIDTH > maxWidth) {
            return AIPANEL_MINWIDTH;
        }
        return Math.max(AIPANEL_MINWIDTH, Math.min(width, maxWidth));
    }

    getAIPanelVisible(): boolean {
        this.initializeFromTabMeta();
        return this.aiPanelVisible;
    }

    setAIPanelVisible(visible: boolean): void {
        if (!isDev() && visible) {
            return;
        }
        this.aiPanelVisible = visible;
        globalStore.set(this.panelVisibleAtom, visible);
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("tab", this.getTabId()),
            meta: { "waveai:panelopen": visible },
        });
        this.syncAIPanelRef();
    }

    getAIPanelWidth(): number {
        this.initializeFromTabMeta();
        if (this.aiPanelWidth == null) {
            this.aiPanelWidth = Math.max(AIPANEL_DEFAULTWIDTH, window.innerWidth / 3);
        }
        return this.aiPanelWidth;
    }

    setAIPanelWidth(width: number): void {
        this.aiPanelWidth = width;
        this.debouncedPersistWidth(width);
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
        if (!this.getAIPanelVisible()) {
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

export { workspaceLayoutModel, WorkspaceLayoutModel };
