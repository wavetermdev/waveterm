// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { getLayoutModelForTabById } from "@/layout/index";
import { RpcResponseHelper, WshClient } from "./wshclient";

export class TabClient extends WshClient {
    constructor(routeId: string) {
        super(routeId);
    }

    handle_captureblockscreenshot(rh: RpcResponseHelper, data: CommandCaptureBlockScreenshotData): Promise<string> {
        return this.captureBlockScreenshot(data.blockid);
    }

    async captureBlockScreenshot(blockId: string): Promise<string> {
        const tabId = globalStore.get(atoms.staticTabId);
        const layoutModel = getLayoutModelForTabById(tabId);
        if (!layoutModel) {
            throw new Error("Layout model not found");
        }

        const node = layoutModel.getNodeByBlockId(blockId);
        if (!node) {
            throw new Error(`Block not found: ${blockId}`);
        }

        const additionalProps = layoutModel.getNodeAdditionalProperties(node);
        if (!additionalProps?.rect) {
            throw new Error(`Block rect not found for: ${blockId}`);
        }

        const displayContainer = layoutModel.displayContainerRef.current;
        if (!displayContainer) {
            throw new Error("Display container not found");
        }

        const containerRect = displayContainer.getBoundingClientRect();
        const blockRect = additionalProps.rect;

        const electronRect: Electron.Rectangle = {
            x: Math.round(containerRect.x + blockRect.left),
            y: Math.round(containerRect.y + blockRect.top),
            width: Math.round(blockRect.width),
            height: Math.round(blockRect.height),
        };

        return await getApi().captureScreenshot(electronRect);
    }
}
