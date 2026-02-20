// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockModel } from "@/app/block/block-model";
import { BlockFrame_Header } from "@/app/block/blockframe-header";
import { blockViewToIcon, getViewIconElem } from "@/app/block/blockutil";
import { ConnStatusOverlay } from "@/app/block/connstatusoverlay";
import { ChangeConnectionBlockModal } from "@/app/modals/conntypeahead";
import { atoms, getBlockComponentModel, getSettingsKeyAtom, globalStore, useBlockAtom, WOS } from "@/app/store/global";
import { useTabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { ErrorBoundary } from "@/element/errorboundary";
import { NodeModel } from "@/layout/index";
import * as util from "@/util/util";
import { makeIconClass } from "@/util/util";
import { computeBgStyleFromMeta } from "@/util/waveutil";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";
import { BlockFrameProps } from "./blocktypes";

const BlockMask = React.memo(({ nodeModel }: { nodeModel: NodeModel }) => {
    const tabModel = useTabModel();
    const isFocused = jotai.useAtomValue(nodeModel.isFocused);
    const isEphemeral = jotai.useAtomValue(nodeModel.isEphemeral);
    const blockNum = jotai.useAtomValue(nodeModel.blockNum);
    const isLayoutMode = jotai.useAtomValue(atoms.controlShiftDelayAtom);
    const showOverlayBlockNums = jotai.useAtomValue(getSettingsKeyAtom("app:showoverlayblocknums")) ?? true;
    const blockHighlight = jotai.useAtomValue(BlockModel.getInstance().getBlockHighlightAtom(nodeModel.blockId));
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", nodeModel.blockId));
    const tabActiveBorderColor = jotai.useAtomValue(tabModel.getTabMetaAtom("bg:activebordercolor"));
    const tabBorderColor = jotai.useAtomValue(tabModel.getTabMetaAtom("bg:bordercolor"));
    const style: React.CSSProperties = {};
    let showBlockMask = false;

    if (isFocused) {
        if (tabActiveBorderColor) {
            style.borderColor = tabActiveBorderColor;
        }
        if (blockData?.meta?.["frame:activebordercolor"]) {
            style.borderColor = blockData.meta["frame:activebordercolor"];
        }
    } else {
        if (tabBorderColor) {
            style.borderColor = tabBorderColor;
        }
        if (blockData?.meta?.["frame:bordercolor"]) {
            style.borderColor = blockData.meta["frame:bordercolor"];
        }
        if (isEphemeral && !style.borderColor) {
            style.borderColor = "rgba(255, 255, 255, 0.7)";
        }
    }

    if (blockHighlight && !style.borderColor) {
        style.borderColor = "rgb(59, 130, 246)";
    }

    let innerElem = null;
    if (isLayoutMode && showOverlayBlockNums) {
        showBlockMask = true;
        innerElem = (
            <div className="block-mask-inner">
                <div className="bignum">{blockNum}</div>
            </div>
        );
    } else if (blockHighlight) {
        showBlockMask = true;
        const iconClass = makeIconClass(blockHighlight.icon, false);
        innerElem = (
            <div className="block-mask-inner">
                <i className={iconClass} style={{ fontSize: "48px", opacity: 0.5 }} />
            </div>
        );
    }

    return (
        <div
            className={clsx("block-mask", { "show-block-mask": showBlockMask, "bg-blue-500/10": blockHighlight })}
            style={style}
        >
            {innerElem}
        </div>
    );
});

const BlockFrame_Default_Component = (props: BlockFrameProps) => {
    const { nodeModel, viewModel, blockModel, preview, numBlocksInTab, children } = props;
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", nodeModel.blockId));
    const isFocused = jotai.useAtomValue(nodeModel.isFocused);
    const aiPanelVisible = jotai.useAtomValue(WorkspaceLayoutModel.getInstance().panelVisibleAtom);
    const viewIconUnion = util.useAtomValueSafe(viewModel?.viewIcon) ?? blockViewToIcon(blockData?.meta?.view);
    const customBg = util.useAtomValueSafe(viewModel?.blockBg);
    const manageConnection = util.useAtomValueSafe(viewModel?.manageConnection);
    const changeConnModalAtom = useBlockAtom(nodeModel.blockId, "changeConn", () => {
        return jotai.atom(false);
    }) as jotai.PrimitiveAtom<boolean>;
    const connModalOpen = jotai.useAtomValue(changeConnModalAtom);
    const isMagnified = jotai.useAtomValue(nodeModel.isMagnified);
    const isEphemeral = jotai.useAtomValue(nodeModel.isEphemeral);
    const [magnifiedBlockBlurAtom] = React.useState(() => getSettingsKeyAtom("window:magnifiedblockblurprimarypx"));
    const magnifiedBlockBlur = jotai.useAtomValue(magnifiedBlockBlurAtom);
    const [magnifiedBlockOpacityAtom] = React.useState(() => getSettingsKeyAtom("window:magnifiedblockopacity"));
    const magnifiedBlockOpacity = jotai.useAtomValue(magnifiedBlockOpacityAtom);
    const connBtnRef = React.useRef<HTMLDivElement>(null);
    const noHeader = util.useAtomValueSafe(viewModel?.noHeader);

    React.useEffect(() => {
        if (!manageConnection) {
            return;
        }
        const bcm = getBlockComponentModel(nodeModel.blockId);
        if (bcm != null) {
            bcm.openSwitchConnection = () => {
                globalStore.set(changeConnModalAtom, true);
            };
        }
        return () => {
            const bcm = getBlockComponentModel(nodeModel.blockId);
            if (bcm != null) {
                bcm.openSwitchConnection = null;
            }
        };
    }, [manageConnection]);
    React.useEffect(() => {
        // on mount, if manageConnection, call ConnEnsure
        if (!manageConnection || blockData == null || preview) {
            return;
        }
        const connName = blockData?.meta?.connection;
        if (!util.isLocalConnName(connName)) {
            console.log("ensure conn", nodeModel.blockId, connName);
            RpcApi.ConnEnsureCommand(
                TabRpcClient,
                { connname: connName, logblockid: nodeModel.blockId },
                { timeout: 60000 }
            ).catch((e) => {
                console.log("error ensuring connection", nodeModel.blockId, connName, e);
            });
        }
    }, [manageConnection, blockData]);

    const viewIconElem = getViewIconElem(viewIconUnion, blockData);
    let innerStyle: React.CSSProperties = {};
    if (!preview) {
        innerStyle = computeBgStyleFromMeta(customBg);
    }
    const previewElem = <div className="block-frame-preview">{viewIconElem}</div>;
    const headerElem = (
        <BlockFrame_Header {...props} connBtnRef={connBtnRef} changeConnModalAtom={changeConnModalAtom} />
    );
    const headerElemNoView = React.cloneElement(headerElem, { viewModel: null });
    return (
        <div
            className={clsx("block", "block-frame-default", "block-" + nodeModel.blockId, {
                "block-focused": isFocused || preview,
                "block-preview": preview,
                "block-no-highlight": numBlocksInTab === 1 && !aiPanelVisible,
                ephemeral: isEphemeral,
                magnified: isMagnified,
            })}
            data-blockid={nodeModel.blockId}
            onClick={blockModel?.onClick}
            onPointerEnter={blockModel?.onPointerEnter}
            onFocusCapture={blockModel?.onFocusCapture}
            ref={blockModel?.blockRef}
            style={
                {
                    "--magnified-block-opacity": magnifiedBlockOpacity,
                    "--magnified-block-blur": `${magnifiedBlockBlur}px`,
                } as React.CSSProperties
            }
            // @ts-ignore: inert does exist in the DOM, just not in react
            inert={preview ? "1" : undefined} //
        >
            <BlockMask nodeModel={nodeModel} />
            {preview || viewModel == null || !manageConnection ? null : (
                <ConnStatusOverlay
                    nodeModel={nodeModel}
                    viewModel={viewModel}
                    changeConnModalAtom={changeConnModalAtom}
                />
            )}
            <div className="block-frame-default-inner" style={innerStyle}>
                {noHeader || <ErrorBoundary fallback={headerElemNoView}>{headerElem}</ErrorBoundary>}
                {preview ? previewElem : children}
            </div>
            {preview || viewModel == null || !connModalOpen ? null : (
                <ChangeConnectionBlockModal
                    blockId={nodeModel.blockId}
                    nodeModel={nodeModel}
                    viewModel={viewModel}
                    blockRef={blockModel?.blockRef}
                    changeConnModalAtom={changeConnModalAtom}
                    connBtnRef={connBtnRef}
                />
            )}
        </div>
    );
};

const BlockFrame_Default = React.memo(BlockFrame_Default_Component) as typeof BlockFrame_Default_Component;

const BlockFrame = React.memo((props: BlockFrameProps) => {
    const tabModel = useTabModel();
    const blockId = props.nodeModel.blockId;
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const numBlocks = jotai.useAtomValue(tabModel.tabNumBlocksAtom);
    if (!blockId || !blockData) {
        return null;
    }
    return <BlockFrame_Default {...props} numBlocksInTab={numBlocks} />;
});

export { BlockFrame };
