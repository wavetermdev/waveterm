// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { MagicLayout } from "@/app/magiclayout";
import { Model } from "./model";

interface SidebarModel {}

class RightSidebarModel implements SidebarModel {
    globalModel: Model = null;
    tempWidth: OV<number> = mobx.observable.box(null, {
        name: "RightSidebarModel-tempWidth",
    });
    tempCollapsed: OV<boolean> = mobx.observable.box(null, {
        name: "RightSidebarModel-tempCollapsed",
    });
    isDragging: OV<boolean> = mobx.observable.box(false, {
        name: "RightSidebarModel-isDragging",
    });

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
    }

    setTempWidthAndTempCollapsed(newWidth: number, newCollapsed: boolean): void {
        const width = Math.max(MagicLayout.RightSidebarMinWidth, Math.min(newWidth, MagicLayout.RightSidebarMaxWidth));

        mobx.action(() => {
            this.tempWidth.set(width);
            this.tempCollapsed.set(newCollapsed);
        })();
    }

    /**
     * Gets the intended width for the sidebar. If the sidebar is being dragged, returns the tempWidth. If the sidebar is collapsed, returns the default width.
     * @param ignoreCollapse If true, returns the persisted width even if the sidebar is collapsed.
     * @returns The intended width for the sidebar or the default width if the sidebar is collapsed. Can be overridden using ignoreCollapse.
     */
    getWidth(ignoreCollapse: boolean = false): number {
        const clientData = this.globalModel.clientData.get();
        let width = clientData?.clientopts?.mainsidebar?.width ?? MagicLayout.RightSidebarDefaultWidth;
        if (this.isDragging.get()) {
            if (this.tempWidth.get() == null && width == null) {
                return MagicLayout.RightSidebarDefaultWidth;
            }
            if (this.tempWidth.get() == null) {
                return width;
            }
            return this.tempWidth.get();
        }
        // Set by CLI and collapsed
        if (this.getCollapsed()) {
            if (ignoreCollapse) {
                return width;
            } else {
                return MagicLayout.RightSidebarMinWidth;
            }
        } else {
            if (width <= MagicLayout.RightSidebarMinWidth) {
                width = MagicLayout.RightSidebarDefaultWidth;
            }
            const snapPoint = MagicLayout.RightSidebarMinWidth + MagicLayout.RightSidebarSnapThreshold;
            if (width < snapPoint || width > MagicLayout.RightSidebarMaxWidth) {
                width = MagicLayout.RightSidebarDefaultWidth;
            }
        }
        return width;
    }

    getCollapsed(): boolean {
        const clientData = this.globalModel.clientData.get();
        const collapsed = clientData?.clientopts?.mainsidebar?.collapsed;
        if (this.isDragging.get()) {
            if (this.tempCollapsed.get() == null && collapsed == null) {
                return false;
            }
            if (this.tempCollapsed.get() == null) {
                return collapsed;
            }
            return this.tempCollapsed.get();
        }
        return collapsed;
    }
}

export { RightSidebarModel };
