// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { getApi } from "@/app/store/global";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { base64ToArray } from "@/util/util";
import { RpcResponseHelper, WshClient } from "./wshclient";

export class TabClient extends WshClient {
    constructor(routeId: string) {
        super(routeId);
    }

    handle_captureblockscreenshot(rh: RpcResponseHelper, data: CommandCaptureBlockScreenshotData): Promise<string> {
        return this.captureBlockScreenshot(data.blockid);
    }

    async captureBlockScreenshot(blockId: string): Promise<string> {
        const layoutModel = getLayoutModelForStaticTab();
        if (!layoutModel) {
            throw new Error("Layout model not found");
        }

        const node = layoutModel.getNodeByBlockId(blockId);
        if (!node) {
            throw new Error(`Block not found: ${blockId}`);
        }

        const displayContainer = layoutModel.displayContainerRef.current;
        if (!displayContainer) {
            throw new Error("Display container not found");
        }

        const containerRect = displayContainer.getBoundingClientRect();
        const additionalProps = layoutModel.getNodeAdditionalProperties(node);

        let electronRect: Electron.Rectangle;

        if (!additionalProps?.rect) {
            // Bug: rect is not set when there is only one block in the layout
            // In this case, use the full container rect
            electronRect = {
                x: Math.round(containerRect.x),
                y: Math.round(containerRect.y),
                width: Math.round(containerRect.width),
                height: Math.round(containerRect.height),
            };
        } else {
            const blockRect = additionalProps.rect;
            electronRect = {
                x: Math.round(containerRect.x + blockRect.left),
                y: Math.round(containerRect.y + blockRect.top),
                width: Math.round(blockRect.width),
                height: Math.round(blockRect.height),
            };
        }

        return await getApi().captureScreenshot(electronRect);
    }

    async handle_waveaiaddcontext(rh: RpcResponseHelper, data: CommandWaveAIAddContextData): Promise<void> {
        const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
        if (!workspaceLayoutModel.getAIPanelVisible()) {
            workspaceLayoutModel.setAIPanelVisible(true, { nofocus: true });
        }

        const model = WaveAIModel.getInstance();

        if (data.newchat) {
            model.clearChat();
        }

        if (data.files && data.files.length > 0) {
            for (const fileData of data.files) {
                const decodedData = base64ToArray(fileData.data64);
                const blob = new Blob([decodedData], { type: fileData.type });
                const file = new File([blob], fileData.name, { type: fileData.type });
                await model.addFile(file);
            }
        }

        if (data.text) {
            model.appendText(data.text);
        }

        if (data.submit) {
            await model.handleSubmit(false);
        }
    }
}
