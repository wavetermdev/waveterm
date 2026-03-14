// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { globalStore } from "@/app/store/jotaiStore";
import { isBuilderWindow } from "@/app/store/windowtype";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getLayoutModelForStaticTab } from "@/layout/lib/layoutModelHooks";
import { atoms, getApi, getOrefMetaKeyAtom, isDev, recordTEvent, refocusNode } from "@/store/global";
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
const VTabBar_MinWidth = 110;
const VTabBar_MaxWidth = 280;

type SidePanelView = "waveai" | "fileexplorer";

function clampVTabWidth(w: number): number {
    return Math.max(VTabBar_MinWidth, Math.min(w, VTabBar_MaxWidth));
}

function clampAIPanelWidth(w: number, windowWidth: number): number {
    const maxWidth = Math.floor(windowWidth * AIPanel_MaxWidthRatio);
    if (AIPanel_MinWidth > maxWidth) return AIPanel_MinWidth;
    return Math.max(AIPanel_MinWidth, Math.min(w, maxWidth));
}

class WorkspaceLayoutModel {
    private static instance: WorkspaceLayoutModel | null = null;

    aiPanelRef: ImperativePanelHandle | null;
    vtabPanelRef: ImperativePanelHandle | null;
    outerPanelGroupRef: ImperativePanelGroupHandle | null;
    innerPanelGroupRef: ImperativePanelGroupHandle | null;
    panelContainerRef: HTMLDivElement | null;
    aiPanelWrapperRef: HTMLDivElement | null;
    panelVisibleAtom: jotai.PrimitiveAtom<boolean>;
    vtabVisibleAtom: jotai.PrimitiveAtom<boolean>;
    activePanelAtom: jotai.PrimitiveAtom<SidePanelView | null>;

    private inResize: boolean;
    private aiPanelVisible: boolean;
    private aiPanelWidth: number | null;
    private vtabWidth: number;
    private vtabVisible: boolean;
    private initialized: boolean = false;
    private transitionTimeoutRef: NodeJS.Timeout | null = null;
    private focusTimeoutRef: NodeJS.Timeout | null = null;
    private debouncedPersistAIWidth: (width: number) => void;
    private debouncedPersistVTabWidth: (width: number) => void;

    private constructor() {
        this.aiPanelRef = null;
        this.vtabPanelRef = null;
        this.outerPanelGroupRef = null;
        this.innerPanelGroupRef = null;
        this.panelContainerRef = null;
        this.aiPanelWrapperRef = null;
        this.inResize = false;
        this.aiPanelVisible = false;
        this.aiPanelWidth = null;
        this.vtabWidth = VTabBar_DefaultWidth;
        this.vtabVisible = false;
        this.panelVisibleAtom = jotai.atom(false);
        this.vtabVisibleAtom = jotai.atom(false);
        this.activePanelAtom = jotai.atom(null) as jotai.PrimitiveAtom<SidePanelView | null>;

        this.handleWindowResize = this.handleWindowResize.bind(this);
        this.handleOuterPanelLayout = this.handleOuterPanelLayout.bind(this);
        this.handleInnerPanelLayout = this.handleInnerPanelLayout.bind(this);

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

    private getTabId(): string {
        return globalStore.get(atoms.staticTabId);
    }

    private getWorkspaceId(): string {
        return globalStore.get(atoms.workspace)?.oid ?? "";
    }

    private getPanelOpenAtom(): jotai.Atom<boolean> {
        return getOrefMetaKeyAtom(WOS.makeORef("tab", this.getTabId()), "waveai:panelopen");
    }

    private getPanelWidthAtom(): jotai.Atom<number> {
        return getOrefMetaKeyAtom(WOS.makeORef("tab", this.getTabId()), "waveai:panelwidth");
    }

    private getVTabBarWidthAtom(): jotai.Atom<number> {
        return getOrefMetaKeyAtom(WOS.makeORef("workspace", this.getWorkspaceId()), "layout:vtabbarwidth");
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
                globalStore.set(this.activePanelAtom, savedVisible ? "waveai" : null);
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

    private getResolvedAIWidth(windowWidth: number): number {
        this.initializeFromMeta();
        let w = this.aiPanelWidth;
        if (w == null) {
            w = Math.max(AIPanel_DefaultWidth, windowWidth * AIPanel_DefaultWidthRatio);
            this.aiPanelWidth = w;
        }
        return clampAIPanelWidth(w, windowWidth);
    }

    private getResolvedVTabWidth(): number {
        this.initializeFromMeta();
        return clampVTabWidth(this.vtabWidth);
    }

    private computeLayout(windowWidth: number): { outer: number[]; inner: number[] } {
        const vtabW = this.vtabVisible ? this.getResolvedVTabWidth() : 0;
        const aiW = this.aiPanelVisible ? this.getResolvedAIWidth(windowWidth) : 0;
        const leftGroupW = vtabW + aiW;

        const leftPct = windowWidth > 0 ? (leftGroupW / windowWidth) * 100 : 0;
        const contentPct = Math.max(0, 100 - leftPct);

        let vtabPct: number;
        let aiPct: number;
        if (leftGroupW > 0) {
            vtabPct = (vtabW / leftGroupW) * 100;
            aiPct = 100 - vtabPct;
        } else {
            vtabPct = 50;
            aiPct = 50;
        }

        return { outer: [leftPct, contentPct], inner: [vtabPct, aiPct] };
    }

    private commitLayouts(windowWidth: number): void {
        if (!this.outerPanelGroupRef || !this.innerPanelGroupRef) return;
        const { outer, inner } = this.computeLayout(windowWidth);
        this.inResize = true;
        this.outerPanelGroupRef.setLayout(outer);
        this.innerPanelGroupRef.setLayout(inner);
        this.inResize = false;
        this.updateWrapperWidth();
    }

    handleOuterPanelLayout(sizes: number[]): void {
        if (this.inResize) return;
        const windowWidth = window.innerWidth;
        const newLeftGroupPx = (sizes[0] / 100) * windowWidth;

        if (this.vtabVisible && this.aiPanelVisible) {
            const vtabW = this.getResolvedVTabWidth();
            const newAIW = clampAIPanelWidth(newLeftGroupPx - vtabW, windowWidth);
            this.aiPanelWidth = newAIW;
            this.debouncedPersistAIWidth(newAIW);
        } else if (this.vtabVisible) {
            const clamped = clampVTabWidth(newLeftGroupPx);
            this.vtabWidth = clamped;
            this.debouncedPersistVTabWidth(clamped);
        } else if (this.aiPanelVisible) {
            const clamped = clampAIPanelWidth(newLeftGroupPx, windowWidth);
            this.aiPanelWidth = clamped;
            this.debouncedPersistAIWidth(clamped);
        }

        this.commitLayouts(windowWidth);
    }

    handleInnerPanelLayout(sizes: number[]): void {
        if (this.inResize) return;
        if (!this.vtabVisible || !this.aiPanelVisible) return;

        const windowWidth = window.innerWidth;
        const vtabW = this.getResolvedVTabWidth();
        const aiW = this.getResolvedAIWidth(windowWidth);
        const leftGroupW = vtabW + aiW;

        const newVTabW = (sizes[0] / 100) * leftGroupW;
        const clampedVTab = clampVTabWidth(newVTabW);
        const newAIW = clampAIPanelWidth(leftGroupW - clampedVTab, windowWidth);

        if (clampedVTab !== this.vtabWidth) {
            this.vtabWidth = clampedVTab;
            this.debouncedPersistVTabWidth(clampedVTab);
        }
        if (newAIW !== this.aiPanelWidth) {
            this.aiPanelWidth = newAIW;
            this.debouncedPersistAIWidth(newAIW);
        }

        this.commitLayouts(windowWidth);
    }

    handleWindowResize(): void {
        this.commitLayouts(window.innerWidth);
    }

    syncVTabWidthFromMeta(): void {
        const savedVTabWidth = globalStore.get(this.getVTabBarWidthAtom());
        if (savedVTabWidth != null && savedVTabWidth > 0 && savedVTabWidth !== this.vtabWidth) {
            this.vtabWidth = savedVTabWidth;
            this.commitLayouts(window.innerWidth);
        }
    }

    registerRefs(
        aiPanelRef: ImperativePanelHandle,
        outerPanelGroupRef: ImperativePanelGroupHandle,
        innerPanelGroupRef: ImperativePanelGroupHandle,
        panelContainerRef: HTMLDivElement,
        aiPanelWrapperRef: HTMLDivElement,
        vtabPanelRef?: ImperativePanelHandle,
        showLeftTabBar?: boolean
    ): void {
        this.aiPanelRef = aiPanelRef;
        this.vtabPanelRef = vtabPanelRef ?? null;
        this.outerPanelGroupRef = outerPanelGroupRef;
        this.innerPanelGroupRef = innerPanelGroupRef;
        this.panelContainerRef = panelContainerRef;
        this.aiPanelWrapperRef = aiPanelWrapperRef;
        this.vtabVisible = showLeftTabBar ?? false;
        globalStore.set(this.vtabVisibleAtom, this.vtabVisible);
        this.syncPanelCollapse();
        this.commitLayouts(window.innerWidth);
    }

    private syncPanelCollapse(): void {
        if (this.aiPanelRef) {
            if (this.aiPanelVisible) {
                this.aiPanelRef.expand();
            } else {
                this.aiPanelRef.collapse();
            }
        }
        if (this.vtabPanelRef) {
            if (this.vtabVisible) {
                this.vtabPanelRef.expand();
            } else {
                this.vtabPanelRef.collapse();
            }
        }
    }

    enableTransitions(duration: number): void {
        if (!this.panelContainerRef) return;
        const panels = this.panelContainerRef.querySelectorAll("[data-panel]");
        panels.forEach((panel: HTMLElement) => {
            panel.style.transition = "flex 0.2s ease-in-out";
        });
        if (this.transitionTimeoutRef) {
            clearTimeout(this.transitionTimeoutRef);
        }
        this.transitionTimeoutRef = setTimeout(() => {
            if (!this.panelContainerRef) return;
            const panels = this.panelContainerRef.querySelectorAll("[data-panel]");
            panels.forEach((panel: HTMLElement) => {
                panel.style.transition = "none";
            });
        }, duration);
    }

    updateWrapperWidth(): void {
        if (!this.aiPanelWrapperRef) return;
        const width = this.getResolvedAIWidth(window.innerWidth);
        this.aiPanelWrapperRef.style.width = `${width}px`;
    }

    getAIPanelVisible(): boolean {
        this.initializeFromMeta();
        return this.aiPanelVisible;
    }

    getAIPanelWidth(): number {
        return this.getResolvedAIWidth(window.innerWidth);
    }

    getActivePanel(): SidePanelView | null {
        return globalStore.get(this.activePanelAtom);
    }

    getLeftGroupInitialPercentage(windowWidth: number, showLeftTabBar: boolean): number {
        this.initializeFromMeta();
        const vtabW = showLeftTabBar && !isBuilderWindow() ? this.getResolvedVTabWidth() : 0;
        const aiW = this.aiPanelVisible ? this.getResolvedAIWidth(windowWidth) : 0;
        return ((vtabW + aiW) / windowWidth) * 100;
    }

    getInnerVTabInitialPercentage(windowWidth: number, showLeftTabBar: boolean): number {
        if (!showLeftTabBar || isBuilderWindow()) return 0;
        this.initializeFromMeta();
        const vtabW = this.getResolvedVTabWidth();
        const aiW = this.aiPanelVisible ? this.getResolvedAIWidth(windowWidth) : 0;
        const total = vtabW + aiW;
        if (total === 0) return 50;
        return (vtabW / total) * 100;
    }

    getInnerAIPanelInitialPercentage(windowWidth: number, showLeftTabBar: boolean): number {
        this.initializeFromMeta();
        const vtabW = showLeftTabBar && !isBuilderWindow() ? this.getResolvedVTabWidth() : 0;
        const aiW = this.aiPanelVisible ? this.getResolvedAIWidth(windowWidth) : 0;
        const total = vtabW + aiW;
        if (total === 0) return 50;
        return (aiW / total) * 100;
    }

    openPanel(panel: SidePanelView, opts?: { nofocus?: boolean }): void {
        if (!isDev() && panel !== "waveai") {
            return;
        }
        if (this.focusTimeoutRef != null) {
            clearTimeout(this.focusTimeoutRef);
            this.focusTimeoutRef = null;
        }
        const wasVisible = this.aiPanelVisible;
        this.aiPanelVisible = true;
        globalStore.set(this.activePanelAtom, panel);
        globalStore.set(this.panelVisibleAtom, true);
        if (!wasVisible) {
            if (panel === "waveai") {
                recordTEvent("action:openwaveai");
            } else if (panel === "fileexplorer") {
                recordTEvent("action:openfileexplorer");
            }
        }
        getApi().setWaveAIOpen(true);
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("tab", this.getTabId()),
            meta: { "waveai:panelopen": true },
        });
        this.enableTransitions(250);
        this.syncPanelCollapse();
        this.commitLayouts(window.innerWidth);

        if (panel === "waveai" && !opts?.nofocus) {
            this.focusTimeoutRef = setTimeout(() => {
                WaveAIModel.getInstance().focusInput();
                this.focusTimeoutRef = null;
            }, 350);
        }
    }

    closePanel(): void {
        if (this.focusTimeoutRef != null) {
            clearTimeout(this.focusTimeoutRef);
            this.focusTimeoutRef = null;
        }
        this.aiPanelVisible = false;
        globalStore.set(this.activePanelAtom, null);
        globalStore.set(this.panelVisibleAtom, false);
        getApi().setWaveAIOpen(false);
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("tab", this.getTabId()),
            meta: { "waveai:panelopen": false },
        });
        this.enableTransitions(250);
        this.syncPanelCollapse();
        this.commitLayouts(window.innerWidth);

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

    togglePanel(panel: SidePanelView, opts?: { nofocus?: boolean }): void {
        if (this.getActivePanel() === panel) {
            this.closePanel();
        } else {
            this.openPanel(panel, opts);
        }
    }

    setAIPanelVisible(visible: boolean, opts?: { nofocus?: boolean }): void {
        if (visible) {
            this.openPanel("waveai", opts);
        } else {
            this.closePanel();
        }
    }

    setFileExplorerPanelVisible(visible: boolean): void {
        if (!isDev()) {
            return;
        }
        if (visible) {
            this.openPanel("fileexplorer", { nofocus: true });
            return;
        }
        if (this.getActivePanel() === "fileexplorer") {
            this.closePanel();
        }
    }

    setShowLeftTabBar(showLeftTabBar: boolean): void {
        if (this.vtabVisible === showLeftTabBar) return;
        this.vtabVisible = showLeftTabBar;
        globalStore.set(this.vtabVisibleAtom, showLeftTabBar);
        this.enableTransitions(250);
        this.syncPanelCollapse();
        this.commitLayouts(window.innerWidth);
    }
}

export { WorkspaceLayoutModel };
