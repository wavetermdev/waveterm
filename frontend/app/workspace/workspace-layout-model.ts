// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { globalStore } from "@/app/store/jotaiStore";
import { isBuilderWindow } from "@/app/store/windowtype";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getLayoutModelForStaticTab } from "@/layout/lib/layoutModelHooks";
import { atoms, getApi, getOrefMetaKeyAtom, recordTEvent, refocusNode } from "@/store/global";
import debug from "debug";
import * as jotai from "jotai";
import { debounce } from "lodash-es";
import { ImperativePanelGroupHandle, ImperativePanelHandle } from "react-resizable-panels";

const dlog = debug("wave:workspace");

const AIPanel_DefaultWidth = 300;
const AIPanel_DefaultWidthRatio = 0.33;
const AIPanel_MinWidth = 300;
const AIPanel_MaxWidthRatio = 0.66;

const VTabBar_DefaultWidth = 220;
const VTabBar_MinWidth = 100;
const VTabBar_MaxWidth = 280;

class WorkspaceLayoutModel {
    private static instance: WorkspaceLayoutModel | null = null;

    aiPanelRef: ImperativePanelHandle | null;
    vtabPanelRef: ImperativePanelHandle | null;
    panelGroupRef: ImperativePanelGroupHandle | null;
    panelContainerRef: HTMLDivElement | null;
    aiPanelWrapperRef: HTMLDivElement | null;
    inResize: boolean; // prevents recursive setLayout calls (setLayout triggers onLayout which calls setLayout)
    private aiPanelVisible: boolean;
    private aiPanelWidth: number | null;
    private vtabWidth: number;
    private showLeftTabBar: boolean;
    private debouncedPersistAIWidth: (width: number) => void;
    private debouncedPersistVTabWidth: (width: number) => void;
    private initialized: boolean = false;
    private transitionTimeoutRef: NodeJS.Timeout | null = null;
    private focusTimeoutRef: NodeJS.Timeout | null = null;
    panelVisibleAtom: jotai.PrimitiveAtom<boolean>;
    vtabVisibleAtom: jotai.PrimitiveAtom<boolean>;

    private constructor() {
        this.aiPanelRef = null;
        this.vtabPanelRef = null;
        this.panelGroupRef = null;
        this.panelContainerRef = null;
        this.aiPanelWrapperRef = null;
        this.inResize = false;
        this.aiPanelVisible = false;
        this.aiPanelWidth = null;
        this.vtabWidth = VTabBar_DefaultWidth;
        this.showLeftTabBar = false;
        this.panelVisibleAtom = jotai.atom(this.aiPanelVisible);
        this.vtabVisibleAtom = jotai.atom(false);

        this.handleWindowResize = this.handleWindowResize.bind(this);
        this.handlePanelLayout = this.handlePanelLayout.bind(this);

        this.debouncedPersistAIWidth = debounce((width: number) => {
            try {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("tab", this.getTabId()),
                    meta: { "waveai:panelwidth": width },
                });
            } catch (e) {
                console.warn("Failed to persist AI panel width:", e);
            }
        }, 300);

        this.debouncedPersistVTabWidth = debounce((width: number) => {
            try {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("workspace", this.getWorkspaceId()),
                    meta: { "layout:vtabbarwidth": width },
                });
            } catch (e) {
                console.warn("Failed to persist vtabbar width:", e);
            }
        }, 300);
    }

    static getInstance(): WorkspaceLayoutModel {
        if (!WorkspaceLayoutModel.instance) {
            WorkspaceLayoutModel.instance = new WorkspaceLayoutModel();
        }
        return WorkspaceLayoutModel.instance;
    }

    private initializeFromMeta(): void {
        if (this.initialized) return;
        this.initialized = true;

        try {
            const savedVisible = globalStore.get(this.getPanelOpenAtom());
            const savedAIWidth = globalStore.get(this.getPanelWidthAtom());
            const savedVTabWidth = globalStore.get(this.getVTabBarWidthAtom());

            if (savedVisible != null) {
                this.aiPanelVisible = savedVisible;
                globalStore.set(this.panelVisibleAtom, savedVisible);
            }
            if (savedAIWidth != null) {
                this.aiPanelWidth = savedAIWidth;
            }
            if (savedVTabWidth != null && savedVTabWidth > 0) {
                this.vtabWidth = savedVTabWidth;
            }
        } catch (e) {
            console.warn("Failed to initialize from tab meta:", e);
        }
    }

    private getTabId(): string {
        return globalStore.get(atoms.staticTabId);
    }

    private getWorkspaceId(): string {
        return globalStore.get(atoms.workspace)?.oid ?? "";
    }

    private getVTabBarWidthAtom(): jotai.Atom<number> {
        const wsORef = WOS.makeORef("workspace", this.getWorkspaceId());
        return getOrefMetaKeyAtom(wsORef, "layout:vtabbarwidth");
    }

    private getPanelOpenAtom(): jotai.Atom<boolean> {
        const tabORef = WOS.makeORef("tab", this.getTabId());
        return getOrefMetaKeyAtom(tabORef, "waveai:panelopen");
    }

    private getPanelWidthAtom(): jotai.Atom<number> {
        const tabORef = WOS.makeORef("tab", this.getTabId());
        return getOrefMetaKeyAtom(tabORef, "waveai:panelwidth");
    }

    registerRefs(
        aiPanelRef: ImperativePanelHandle,
        panelGroupRef: ImperativePanelGroupHandle,
        panelContainerRef: HTMLDivElement,
        aiPanelWrapperRef: HTMLDivElement,
        vtabPanelRef?: ImperativePanelHandle,
        showLeftTabBar?: boolean
    ): void {
        this.aiPanelRef = aiPanelRef;
        this.vtabPanelRef = vtabPanelRef ?? null;
        this.showLeftTabBar = showLeftTabBar ?? false;
        this.panelGroupRef = panelGroupRef;
        this.panelContainerRef = panelContainerRef;
        this.aiPanelWrapperRef = aiPanelWrapperRef;
        globalStore.set(this.vtabVisibleAtom, this.showLeftTabBar);
        this.syncAIPanelRef();
        this.updateWrapperWidth();
    }

    updateWrapperWidth(): void {
        if (!this.aiPanelWrapperRef) {
            return;
        }
        const width = this.getAIPanelWidth();
        const clampedWidth = this.getClampedAIPanelWidth(width, window.innerWidth);
        this.aiPanelWrapperRef.style.width = `${clampedWidth}px`;
    }

    enableTransitions(duration: number): void {
        if (!this.panelContainerRef) {
            return;
        }
        const panels = this.panelContainerRef.querySelectorAll("[data-panel]");
        panels.forEach((panel: HTMLElement) => {
            panel.style.transition = "flex 0.2s ease-in-out";
        });

        if (this.transitionTimeoutRef) {
            clearTimeout(this.transitionTimeoutRef);
        }
        this.transitionTimeoutRef = setTimeout(() => {
            if (!this.panelContainerRef) {
                return;
            }
            const panels = this.panelContainerRef.querySelectorAll("[data-panel]");
            panels.forEach((panel: HTMLElement) => {
                panel.style.transition = "none";
            });
        }, duration);
    }

    handleWindowResize(): void {
        if (!this.panelGroupRef) {
            return;
        }
        const newWindowWidth = window.innerWidth;
        const layout = this.buildLayout(newWindowWidth);
        this.inResize = true;
        this.panelGroupRef.setLayout(layout);
        this.inResize = false;
        this.updateWrapperWidth();
    }

    handlePanelLayout(sizes: number[]): void {
        // dlog("handlePanelLayout", "inResize:", this.inResize, "sizes:", sizes);
        if (this.inResize) {
            return;
        }
        if (!this.panelGroupRef) {
            return;
        }

        const currentWindowWidth = window.innerWidth;
        const vtabIsVisible = sizes[0] > 0;
        if (globalStore.get(this.vtabVisibleAtom) !== vtabIsVisible) {
            globalStore.set(this.vtabVisibleAtom, vtabIsVisible);
        }
        if (this.showLeftTabBar && sizes[0] > 0) {
            const vtabPixelWidth = (sizes[0] / 100) * currentWindowWidth;
            const clamped = Math.max(VTabBar_MinWidth, Math.min(vtabPixelWidth, VTabBar_MaxWidth));
            if (clamped !== this.vtabWidth) {
                this.vtabWidth = clamped;
                this.debouncedPersistVTabWidth(clamped);
            }
        }
        const aiPanelPixelWidth = (sizes[1] / 100) * currentWindowWidth;
        this.handleAIPanelResize(aiPanelPixelWidth, currentWindowWidth);
        const layout = this.buildLayout(currentWindowWidth);
        this.inResize = true;
        this.panelGroupRef.setLayout(layout);
        this.inResize = false;
    }

    buildLayout(windowWidth: number): number[] {
        const vtabPercentage = this.showLeftTabBar ? this.getVTabBarPercentage(windowWidth) : 0;
        const aiPanelPercentage = this.getAIPanelPercentage(windowWidth);
        const contentPercentage = Math.max(0, 100 - vtabPercentage - aiPanelPercentage);
        return [vtabPercentage, aiPanelPercentage, contentPercentage];
    }

    syncAIPanelRef(): void {
        if (!this.aiPanelRef || !this.panelGroupRef) {
            return;
        }

        if (this.getAIPanelVisible()) {
            this.aiPanelRef.expand();
        } else {
            this.aiPanelRef.collapse();
        }

        const currentWindowWidth = window.innerWidth;
        const layout = this.buildLayout(currentWindowWidth);
        this.inResize = true;
        this.panelGroupRef.setLayout(layout);
        this.inResize = false;
    }

    getVTabBarPercentage(windowWidth: number): number {
        const clamped = Math.max(VTabBar_MinWidth, Math.min(this.vtabWidth, VTabBar_MaxWidth));
        return (clamped / windowWidth) * 100;
    }

    getVTabBarInitialPercentage(windowWidth: number, showLeftTabBar: boolean): number {
        if (!showLeftTabBar || isBuilderWindow()) {
            return 0;
        }
        this.initializeFromMeta();
        return this.getVTabBarPercentage(windowWidth);
    }

    getVTabBarMinPercentage(windowWidth: number): number {
        return (VTabBar_MinWidth / windowWidth) * 100;
    }

    getVTabBarMaxPercentage(windowWidth: number): number {
        return (VTabBar_MaxWidth / windowWidth) * 100;
    }

    getMaxAIPanelWidth(windowWidth: number): number {
        return Math.floor(windowWidth * AIPanel_MaxWidthRatio);
    }

    getClampedAIPanelWidth(width: number, windowWidth: number): number {
        const maxWidth = this.getMaxAIPanelWidth(windowWidth);
        if (AIPanel_MinWidth > maxWidth) {
            return AIPanel_MinWidth;
        }
        return Math.max(AIPanel_MinWidth, Math.min(width, maxWidth));
    }

    getAIPanelVisible(): boolean {
        this.initializeFromMeta();
        return this.aiPanelVisible;
    }

    setAIPanelVisible(visible: boolean, opts?: { nofocus?: boolean }): void {
        if (this.focusTimeoutRef != null) {
            clearTimeout(this.focusTimeoutRef);
            this.focusTimeoutRef = null;
        }
        const wasVisible = this.aiPanelVisible;
        this.aiPanelVisible = visible;
        if (visible && !wasVisible) {
            recordTEvent("action:openwaveai");
        }
        globalStore.set(this.panelVisibleAtom, visible);
        getApi().setWaveAIOpen(visible);
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("tab", this.getTabId()),
            meta: { "waveai:panelopen": visible },
        });
        this.enableTransitions(250);
        this.syncAIPanelRef();

        if (visible) {
            if (!opts?.nofocus) {
                this.focusTimeoutRef = setTimeout(() => {
                    WaveAIModel.getInstance().focusInput();
                    this.focusTimeoutRef = null;
                }, 350);
            }
        } else {
            const layoutModel = getLayoutModelForStaticTab();
            const focusedNode = globalStore.get(layoutModel.focusedNode);
            if (focusedNode == null) {
                layoutModel.focusFirstNode();
                return;
            }
            const blockId = focusedNode?.data?.blockId;
            if (blockId != null) {
                refocusNode(blockId);
            }
        }
    }

    getAIPanelWidth(): number {
        this.initializeFromMeta();
        if (this.aiPanelWidth == null) {
            this.aiPanelWidth = Math.max(AIPanel_DefaultWidth, window.innerWidth * AIPanel_DefaultWidthRatio);
        }
        return this.aiPanelWidth;
    }

    setAIPanelWidth(width: number): void {
        this.aiPanelWidth = width;
        this.updateWrapperWidth();
        this.debouncedPersistAIWidth(width);
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

    handleAIPanelResize(width: number, windowWidth: number): void {
        if (!this.getAIPanelVisible()) {
            return;
        }
        const clampedWidth = this.getClampedAIPanelWidth(width, windowWidth);
        this.setAIPanelWidth(clampedWidth);
    }

    setShowLeftTabBar(showLeftTabBar: boolean): void {
        if (this.showLeftTabBar === showLeftTabBar) {
            return;
        }
        this.showLeftTabBar = showLeftTabBar;
        globalStore.set(this.vtabVisibleAtom, showLeftTabBar);
        if (this.vtabPanelRef) {
            if (showLeftTabBar) {
                this.vtabPanelRef.expand();
            } else {
                this.vtabPanelRef.collapse();
            }
        }
        if (!this.panelGroupRef) {
            return;
        }
        this.enableTransitions(250);
        const layout = this.buildLayout(window.innerWidth);
        this.inResize = true;
        this.panelGroupRef.setLayout(layout);
        this.inResize = false;
    }
}

export { WorkspaceLayoutModel };
