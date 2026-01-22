// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom, Atom, PrimitiveAtom } from "jotai";
import { createContext, useContext } from "react";
import { globalStore } from "./jotaiStore";
import * as WOS from "./wos";

const tabModelCache = new Map<string, TabModel>();
export const activeTabIdAtom = atom<string>(null) as PrimitiveAtom<string>;

// Tab status types based on terminal block states
export type TabStatusType = "stopped" | "finished" | "running" | null;

// Per-block terminal status for aggregation
export interface BlockTerminalStatus {
    shellProcStatus: string | null; // "running", "done", "init", etc.
    shellProcExitCode: number | null;
    shellIntegrationStatus: string | null; // "running-command", "ready", etc.
}

export class TabModel {
    tabId: string;
    tabAtom: Atom<Tab>;
    tabNumBlocksAtom: Atom<number>;
    isTermMultiInput = atom(false) as PrimitiveAtom<boolean>;
    metaCache: Map<string, Atom<any>> = new Map();

    // Validation state atoms for tab base directory
    basedirValidationAtom = atom<"pending" | "valid" | "invalid" | null>(null) as PrimitiveAtom<
        "pending" | "valid" | "invalid" | null
    >;
    lastValidationTimeAtom = atom<number>(0) as PrimitiveAtom<number>;

    // Tracks when a process completes while this tab is in the background
    // This enables the "finished" status icon to show unread completions
    finishedUnreadAtom = atom(false) as PrimitiveAtom<boolean>;

    // Map of blockId -> terminal status for reactive status tracking
    private terminalStatusMap = new Map<string, BlockTerminalStatus>();

    // Atom that holds the computed aggregate terminal status
    // This is updated whenever any terminal block's status changes
    terminalStatusAtom = atom<TabStatusType>(null) as PrimitiveAtom<TabStatusType>;

    constructor(tabId: string) {
        this.tabId = tabId;
        this.tabAtom = atom((get) => {
            return WOS.getObjectValue(WOS.makeORef("tab", this.tabId), get);
        });
        this.tabNumBlocksAtom = atom((get) => {
            const tabData = get(this.tabAtom);
            return tabData?.blockids?.length ?? 0;
        });
    }

    getTabMetaAtom<T extends keyof MetaType>(metaKey: T): Atom<MetaType[T]> {
        let metaAtom = this.metaCache.get(metaKey);
        if (metaAtom == null) {
            metaAtom = atom((get) => {
                const tabData = get(this.tabAtom);
                return tabData?.meta?.[metaKey];
            });
            this.metaCache.set(metaKey, metaAtom);
        }
        return metaAtom;
    }

    getBasedirValidationState(): "pending" | "valid" | "invalid" | null {
        return globalStore.get(this.basedirValidationAtom);
    }

    /**
     * Clears the finishedUnread state when the tab becomes active.
     * This removes the "finished" status icon indicating unread completions.
     */
    clearFinishedUnread(): void {
        globalStore.set(this.finishedUnreadAtom, false);
    }

    /**
     * Marks the tab as having unread process completions.
     * Called when a process completes while this tab is in the background.
     */
    setFinishedUnread(): void {
        globalStore.set(this.finishedUnreadAtom, true);
    }

    /**
     * Updates the terminal status for a specific block and recomputes aggregate status.
     * Called by terminal blocks when their shell proc status or shell integration status changes.
     */
    updateBlockTerminalStatus(blockId: string, status: BlockTerminalStatus): void {
        this.terminalStatusMap.set(blockId, status);
        this.recomputeTerminalStatus();
    }

    /**
     * Removes a block from terminal status tracking (e.g., when block is deleted).
     */
    removeBlockTerminalStatus(blockId: string): void {
        this.terminalStatusMap.delete(blockId);
        this.recomputeTerminalStatus();
    }

    /**
     * Recomputes the aggregate terminal status from all tracked blocks.
     * Priority (highest to lowest):
     * 1. stopped - Any block exited with error (exitcode != 0)
     * 2. running - A command is actively executing (via shell integration)
     * 3. finished - Process completed in background (unread) - handled separately
     * 4. null - Idle (no special status to show)
     */
    private recomputeTerminalStatus(): void {
        let hasRunningCommand = false;
        let hasStopped = false;

        for (const status of this.terminalStatusMap.values()) {
            // Priority 1: Any error exit code (shell exited with error)
            if (status.shellProcStatus === "done" && status.shellProcExitCode !== 0) {
                hasStopped = true;
            }

            // Check for running commands via shell integration
            if (status.shellIntegrationStatus === "running-command") {
                hasRunningCommand = true;
            }
        }

        // Compute status with priority
        let newStatus: TabStatusType = null;
        if (hasStopped) {
            newStatus = "stopped";
        } else if (hasRunningCommand) {
            newStatus = "running";
        } else if (globalStore.get(this.finishedUnreadAtom)) {
            newStatus = "finished";
        }

        globalStore.set(this.terminalStatusAtom, newStatus);
    }
}

export function getTabModelByTabId(tabId: string): TabModel {
    let model = tabModelCache.get(tabId);
    if (model == null) {
        model = new TabModel(tabId);
        tabModelCache.set(tabId, model);
    }
    return model;
}

export function getActiveTabModel(): TabModel | null {
    const activeTabId = globalStore.get(activeTabIdAtom);
    if (activeTabId == null) {
        return null;
    }
    return getTabModelByTabId(activeTabId);
}

export const TabModelContext = createContext<TabModel | undefined>(undefined);

export function useTabModel(): TabModel {
    const model = useContext(TabModelContext);
    if (model == null) {
        throw new Error("useTabModel must be used within a TabModelProvider");
    }
    return model;
}

export function maybeUseTabModel(): TabModel {
    return useContext(TabModelContext);
}
