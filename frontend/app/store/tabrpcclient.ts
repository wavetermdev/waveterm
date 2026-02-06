// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { getApi, getBlockComponentModel, getConnStatusAtom, globalStore, WOS } from "@/app/store/global";
import type { TermViewModel } from "@/app/view/term/term-model";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { base64ToArrayBuffer } from "@/util/util";
import { RpcResponseHelper, WshClient } from "./wshclient";
import { RpcApi } from "./wshclientapi";

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
                const decodedData = base64ToArrayBuffer(fileData.data64);
                const blob = new Blob([decodedData], { type: fileData.type });
                const file = new File([blob], fileData.name, { type: fileData.type });
                await model.addFile(file);
            }
        }

        if (data.text) {
            model.appendText(data.text);
        }

        if (data.submit) {
            await model.handleSubmit();
        }
    }

    async handle_setblockfocus(rh: RpcResponseHelper, blockId: string): Promise<void> {
        const layoutModel = getLayoutModelForStaticTab();
        if (!layoutModel) {
            throw new Error("Layout model not found");
        }

        const node = layoutModel.getNodeByBlockId(blockId);
        if (!node) {
            throw new Error(`Block not found in tab: ${blockId}`);
        }

        layoutModel.focusNode(node.id);
    }

    async handle_getfocusedblockdata(rh: RpcResponseHelper): Promise<FocusedBlockData> {
        const layoutModel = getLayoutModelForStaticTab();
        if (!layoutModel) {
            throw new Error("Layout model not found");
        }

        const focusedNode = globalStore.get(layoutModel.focusedNode);
        const blockId = focusedNode?.data?.blockId;

        if (!blockId) {
            return null;
        }

        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
        const blockData = globalStore.get(blockAtom);

        if (!blockData) {
            return null;
        }

        const viewType = blockData.meta?.view ?? "";
        const controller = blockData.meta?.controller ?? "";
        const connName = blockData.meta?.connection ?? "";

        const result: FocusedBlockData = {
            blockid: blockId,
            viewtype: viewType,
            controller: controller,
            connname: connName,
            blockmeta: blockData.meta ?? {},
        };

        if (viewType === "term" && controller === "shell") {
            const jobStatus = await RpcApi.BlockJobStatusCommand(this, blockId);
            if (jobStatus) {
                result.termjobstatus = jobStatus;
            }
        }

        if (connName) {
            const connStatusAtom = getConnStatusAtom(connName);
            const connStatus = globalStore.get(connStatusAtom);
            if (connStatus) {
                result.connstatus = connStatus;
            }
        }

        if (viewType === "term") {
            try {
                const bcm = getBlockComponentModel(blockId);
                if (bcm?.viewModel) {
                    const termViewModel = bcm.viewModel as TermViewModel;
                    if (termViewModel.termRef?.current?.shellIntegrationStatusAtom) {
                        const shellIntegrationStatus = globalStore.get(termViewModel.termRef.current.shellIntegrationStatusAtom);
                        result.termshellintegrationstatus = shellIntegrationStatus || "";
                    }
                    if (termViewModel.termRef?.current?.lastCommandAtom) {
                        const lastCommand = globalStore.get(termViewModel.termRef.current.lastCommandAtom);
                        result.termlastcommand = lastCommand || "";
                    }
                }
            } catch (e) {
                console.log("error getting term-specific data", e);
            }
        }

        return result;
    }
}
