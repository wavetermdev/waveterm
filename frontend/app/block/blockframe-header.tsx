// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    blockViewToIcon,
    blockViewToName,
    getViewIconElem,
    OptMagnifyButton,
    renderHeaderElements,
} from "@/app/block/blockutil";
import { ConnectionButton } from "@/app/block/connectionbutton";
import { DurableSessionFlyover } from "@/app/block/durable-session-flyover";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { getConnStatusAtom, recordTEvent, WOS } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { uxCloseBlock } from "@/app/store/keymodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { IconButton } from "@/element/iconbutton";
import { NodeModel } from "@/layout/index";
import * as util from "@/util/util";
import { cn } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import { BlockFrameProps } from "./blocktypes";

function handleHeaderContextMenu(
    e: React.MouseEvent<HTMLDivElement>,
    blockId: string,
    viewModel: ViewModel,
    nodeModel: NodeModel
) {
    e.preventDefault();
    e.stopPropagation();
    const magnified = globalStore.get(nodeModel.isMagnified);
    let menu: ContextMenuItem[] = [
        {
            label: magnified ? "Un-Magnify Block" : "Magnify Block",
            click: () => {
                nodeModel.toggleMagnify();
            },
        },
        { type: "separator" },
        {
            label: "Copy BlockId",
            click: () => {
                navigator.clipboard.writeText(blockId);
            },
        },
    ];
    const extraItems = viewModel?.getSettingsMenuItems?.();
    if (extraItems && extraItems.length > 0) menu.push({ type: "separator" }, ...extraItems);
    menu.push(
        { type: "separator" },
        {
            label: "Close Block",
            click: () => uxCloseBlock(blockId),
        }
    );
    ContextMenuModel.showContextMenu(menu, e);
}

type HeaderTextElemsProps = {
    viewModel: ViewModel;
    blockData: Block;
    preview: boolean;
    error?: Error;
};

const HeaderTextElems = React.memo(({ viewModel, blockData, preview, error }: HeaderTextElemsProps) => {
    let headerTextUnion = util.useAtomValueSafe(viewModel?.viewText);
    headerTextUnion = blockData?.meta?.["frame:text"] ?? headerTextUnion;

    const headerTextElems: React.ReactElement[] = [];
    if (typeof headerTextUnion === "string") {
        if (!util.isBlank(headerTextUnion)) {
            headerTextElems.push(
                <div key="text" className="block-frame-text ellipsis">
                    &lrm;{headerTextUnion}
                </div>
            );
        }
    } else if (Array.isArray(headerTextUnion)) {
        headerTextElems.push(...renderHeaderElements(headerTextUnion, preview));
    }
    if (error != null) {
        const copyHeaderErr = () => {
            navigator.clipboard.writeText(error.message + "\n" + error.stack);
        };
        headerTextElems.push(
            <div className="iconbutton disabled" key="controller-status" onClick={copyHeaderErr}>
                <i
                    className="fa-sharp fa-solid fa-triangle-exclamation"
                    title={"Error Rendering View Header: " + error.message}
                />
            </div>
        );
    }

    return <div className="block-frame-textelems-wrapper">{headerTextElems}</div>;
});
HeaderTextElems.displayName = "HeaderTextElems";

type HeaderEndIconsProps = {
    viewModel: ViewModel;
    nodeModel: NodeModel;
    blockId: string;
};

const HeaderEndIcons = React.memo(({ viewModel, nodeModel, blockId }: HeaderEndIconsProps) => {
    const endIconButtons = util.useAtomValueSafe(viewModel?.endIconButtons);
    const magnified = jotai.useAtomValue(nodeModel.isMagnified);
    const ephemeral = jotai.useAtomValue(nodeModel.isEphemeral);
    const numLeafs = jotai.useAtomValue(nodeModel.numLeafs);
    const magnifyDisabled = numLeafs <= 1;

    const endIconsElem: React.ReactElement[] = [];

    if (endIconButtons && endIconButtons.length > 0) {
        endIconsElem.push(...endIconButtons.map((button, idx) => <IconButton key={idx} decl={button} />));
    }
    const settingsDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "cog",
        title: "Settings",
        click: (e) => handleHeaderContextMenu(e, blockId, viewModel, nodeModel),
    };
    endIconsElem.push(<IconButton key="settings" decl={settingsDecl} className="block-frame-settings" />);
    if (ephemeral) {
        const addToLayoutDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: "circle-plus",
            title: "Add to Layout",
            click: () => {
                nodeModel.addEphemeralNodeToLayout();
            },
        };
        endIconsElem.push(<IconButton key="add-to-layout" decl={addToLayoutDecl} />);
    } else {
        endIconsElem.push(
            <OptMagnifyButton
                key="unmagnify"
                magnified={magnified}
                toggleMagnify={nodeModel.toggleMagnify}
                disabled={magnifyDisabled}
            />
        );
    }

    const closeDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "xmark-large",
        title: "Close",
        click: () => uxCloseBlock(nodeModel.blockId),
    };
    endIconsElem.push(<IconButton key="close" decl={closeDecl} className="block-frame-default-close" />);

    return <div className="block-frame-end-icons">{endIconsElem}</div>;
});
HeaderEndIcons.displayName = "HeaderEndIcons";

const BlockFrame_Header = ({
    nodeModel,
    viewModel,
    preview,
    connBtnRef,
    changeConnModalAtom,
    error,
}: BlockFrameProps & { changeConnModalAtom: jotai.PrimitiveAtom<boolean>; error?: Error }) => {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", nodeModel.blockId));
    let viewName = util.useAtomValueSafe(viewModel?.viewName) ?? blockViewToName(blockData?.meta?.view);
    let viewIconUnion = util.useAtomValueSafe(viewModel?.viewIcon) ?? blockViewToIcon(blockData?.meta?.view);
    const preIconButton = util.useAtomValueSafe(viewModel?.preIconButton);
    const useTermHeader = util.useAtomValueSafe(viewModel?.useTermHeader);
    const termConfigedDurable = util.useAtomValueSafe(viewModel?.termConfigedDurable);
    const hideViewName = util.useAtomValueSafe(viewModel?.hideViewName);
    const magnified = jotai.useAtomValue(nodeModel.isMagnified);
    const prevMagifiedState = React.useRef(magnified);
    const manageConnection = util.useAtomValueSafe(viewModel?.manageConnection);
    const dragHandleRef = preview ? null : nodeModel.dragHandleRef;
    const isTerminalBlock = blockData?.meta?.view === "term";
    viewName = blockData?.meta?.["frame:title"] ?? viewName;
    viewIconUnion = blockData?.meta?.["frame:icon"] ?? viewIconUnion;

    React.useEffect(() => {
        if (magnified && !preview && !prevMagifiedState.current) {
            RpcApi.ActivityCommand(TabRpcClient, { nummagnify: 1 });
            recordTEvent("action:magnify", { "block:view": viewName });
        }
        prevMagifiedState.current = magnified;
    }, [magnified]);

    const viewIconElem = getViewIconElem(viewIconUnion, blockData);

    return (
        <div
            className={cn("block-frame-default-header", useTermHeader && "!pl-[2px]")}
            data-role="block-header"
            ref={dragHandleRef}
            onContextMenu={(e) => handleHeaderContextMenu(e, nodeModel.blockId, viewModel, nodeModel)}
        >
            {!useTermHeader && (
                <>
                    {preIconButton && <IconButton decl={preIconButton} className="block-frame-preicon-button" />}
                    <div className="block-frame-default-header-iconview">
                        {viewIconElem}
                        {viewName && !hideViewName && <div className="block-frame-view-type">{viewName}</div>}
                    </div>
                </>
            )}
            {manageConnection && (
                <ConnectionButton
                    ref={connBtnRef}
                    key="connbutton"
                    connection={blockData?.meta?.connection}
                    changeConnModalAtom={changeConnModalAtom}
                    isTerminalBlock={isTerminalBlock}
                />
            )}
            {useTermHeader && termConfigedDurable != null && (
                <DurableSessionFlyover key="durable-status" blockId={nodeModel.blockId} viewModel={viewModel} placement="bottom" divClassName="iconbutton disabled text-[13px] ml-[-4px]" />
            )}
            <HeaderTextElems viewModel={viewModel} blockData={blockData} preview={preview} error={error} />
            <HeaderEndIcons viewModel={viewModel} nodeModel={nodeModel} blockId={nodeModel.blockId} />
        </div>
    );
};

export { BlockFrame_Header };
