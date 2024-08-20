// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { blockViewToIcon, blockViewToName, getBlockHeaderIcon, IconButton, Input } from "@/app/block/blockutil";
import { Button } from "@/app/element/button";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { atoms, globalStore, useBlockAtom, WOS } from "@/app/store/global";
import * as services from "@/app/store/services";
import { MagnifyIcon } from "@/element/magnify";
import { useLayoutModel } from "@/layout/index";
import { checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";
import { BlockFrameProps, LayoutComponentModel } from "./blocktypes";

function handleHeaderContextMenu(
    e: React.MouseEvent<HTMLDivElement>,
    blockData: Block,
    viewModel: ViewModel,
    onMagnifyToggle: () => void,
    onClose: () => void
) {
    e.preventDefault();
    e.stopPropagation();
    let menu: ContextMenuItem[] = [
        {
            label: "Magnify Block",
            click: () => {
                onMagnifyToggle();
            },
        },
        {
            label: "Move to New Window",
            click: () => {
                const currentTabId = globalStore.get(atoms.activeTabId);
                try {
                    services.WindowService.MoveBlockToNewWindow(currentTabId, blockData.oid);
                } catch (e) {
                    console.error("error moving block to new window", e);
                }
            },
        },
        { type: "separator" },
        {
            label: "Copy BlockId",
            click: () => {
                navigator.clipboard.writeText(blockData.oid);
            },
        },
    ];
    const extraItems = viewModel?.getSettingsMenuItems?.();
    if (extraItems && extraItems.length > 0) menu.push({ type: "separator" }, ...extraItems);
    menu.push(
        { type: "separator" },
        {
            label: "Close Block",
            click: onClose,
        }
    );
    ContextMenuModel.showContextMenu(menu, e);
}

function getViewIconElem(viewIconUnion: string | HeaderIconButton, blockData: Block): JSX.Element {
    if (viewIconUnion == null || typeof viewIconUnion === "string") {
        const viewIcon = viewIconUnion as string;
        return <div className="block-frame-view-icon">{getBlockHeaderIcon(viewIcon, blockData)}</div>;
    } else {
        return <IconButton decl={viewIconUnion} className="block-frame-view-icon" />;
    }
}

const OptMagnifyButton = React.memo(({ layoutCompModel }: { layoutCompModel: LayoutComponentModel }) => {
    const magnifyDecl: HeaderIconButton = {
        elemtype: "iconbutton",
        icon: <MagnifyIcon enabled={layoutCompModel?.isMagnified} />,
        title: layoutCompModel?.isMagnified ? "Minimize" : "Magnify",
        click: layoutCompModel?.onMagnifyToggle,
    };
    return <IconButton key="magnify" decl={magnifyDecl} className="block-frame-magnify" />;
});

function computeEndIcons(blockData: Block, viewModel: ViewModel, layoutModel: LayoutComponentModel): JSX.Element[] {
    const endIconsElem: JSX.Element[] = [];
    const endIconButtons = util.useAtomValueSafe(viewModel.endIconButtons);

    if (endIconButtons && endIconButtons.length > 0) {
        endIconsElem.push(...endIconButtons.map((button, idx) => <IconButton key={idx} decl={button} />));
    }
    const settingsDecl: HeaderIconButton = {
        elemtype: "iconbutton",
        icon: "cog",
        title: "Settings",
        click: (e) =>
            handleHeaderContextMenu(e, blockData, viewModel, layoutModel?.onMagnifyToggle, layoutModel?.onClose),
    };
    endIconsElem.push(<IconButton key="settings" decl={settingsDecl} className="block-frame-settings" />);
    endIconsElem.push(<OptMagnifyButton key="unmagnify" layoutCompModel={layoutModel} />);
    const closeDecl: HeaderIconButton = {
        elemtype: "iconbutton",
        icon: "xmark-large",
        title: "Close",
        click: layoutModel?.onClose,
    };
    endIconsElem.push(<IconButton key="close" decl={closeDecl} className="block-frame-default-close" />);
    return endIconsElem;
}

const BlockFrame_Header = ({ blockId, layoutModel, viewModel }: BlockFrameProps) => {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const viewName = util.useAtomValueSafe(viewModel.viewName) ?? blockViewToName(blockData?.meta?.view);
    const settingsConfig = jotai.useAtomValue(atoms.settingsConfigAtom);
    const viewIconUnion = util.useAtomValueSafe(viewModel.viewIcon) ?? blockViewToIcon(blockData?.meta?.view);
    const preIconButton = util.useAtomValueSafe(viewModel.preIconButton);
    const headerTextUnion = util.useAtomValueSafe(viewModel.viewText);

    const endIconsElem = computeEndIcons(blockData, viewModel, layoutModel);
    const viewIconElem = getViewIconElem(viewIconUnion, blockData);
    let preIconButtonElem: JSX.Element = null;
    if (preIconButton) {
        preIconButtonElem = <IconButton decl={preIconButton} className="block-frame-preicon-button" />;
    }

    const headerTextElems: JSX.Element[] = [];
    if (typeof headerTextUnion === "string") {
        if (!util.isBlank(headerTextUnion)) {
            headerTextElems.push(
                <div key="text" className="block-frame-text">
                    {headerTextUnion}
                </div>
            );
        }
    } else if (Array.isArray(headerTextUnion)) {
        headerTextElems.push(...renderHeaderElements(headerTextUnion));
    }

    return (
        <div
            className="block-frame-default-header"
            ref={layoutModel?.dragHandleRef}
            onContextMenu={(e) =>
                handleHeaderContextMenu(e, blockData, viewModel, layoutModel?.onMagnifyToggle, layoutModel?.onClose)
            }
        >
            {preIconButtonElem}
            <div className="block-frame-default-header-iconview">
                {viewIconElem}
                <div className="block-frame-view-type">{viewName}</div>
                {settingsConfig?.blockheader?.showblockids && (
                    <div className="block-frame-blockid">[{blockId.substring(0, 8)}]</div>
                )}
            </div>
            <div className="block-frame-textelems-wrapper">{headerTextElems}</div>
            <div className="block-frame-end-icons">{endIconsElem}</div>
        </div>
    );
};

const HeaderTextElem = React.memo(({ elem }: { elem: HeaderElem }) => {
    if (elem.elemtype == "iconbutton") {
        return <IconButton decl={elem} className={clsx("block-frame-header-iconbutton", elem.className)} />;
    } else if (elem.elemtype == "input") {
        return <Input decl={elem} className={clsx("block-frame-input", elem.className)} />;
    } else if (elem.elemtype == "text") {
        return <div className="block-frame-text">{elem.text}</div>;
    } else if (elem.elemtype == "textbutton") {
        return (
            <Button className={elem.className} onClick={(e) => elem.onClick(e)}>
                {elem.text}
            </Button>
        );
    } else if (elem.elemtype == "div") {
        return (
            <div
                className={clsx("block-frame-div", elem.className)}
                onMouseOver={elem.onMouseOver}
                onMouseOut={elem.onMouseOut}
            >
                {elem.children.map((child, childIdx) => (
                    <HeaderTextElem elem={child} key={childIdx} />
                ))}
            </div>
        );
    }
    return null;
});

function renderHeaderElements(headerTextUnion: HeaderElem[]): JSX.Element[] {
    const headerTextElems: JSX.Element[] = [];
    for (let idx = 0; idx < headerTextUnion.length; idx++) {
        const elem = headerTextUnion[idx];
        const renderedElement = <HeaderTextElem elem={elem} key={idx} />;
        if (renderedElement) {
            headerTextElems.push(renderedElement);
        }
    }
    return headerTextElems;
}

function BlockNum({ blockId }: { blockId: string }) {
    const tabId = jotai.useAtomValue(atoms.activeTabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
    const layoutModel = useLayoutModel(tabAtom);
    for (let idx = 0; idx < layoutModel.leafs.length; idx++) {
        const leaf = layoutModel.leafs[idx];
        if (leaf?.data?.blockId == blockId) {
            return String(idx + 1);
        }
    }
    return null;
}

const BlockMask = ({ blockId, preview, isFocused }: { blockId: string; preview: boolean; isFocused: boolean }) => {
    const isLayoutMode = jotai.useAtomValue(atoms.controlShiftDelayAtom);
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));

    const style: React.CSSProperties = {};
    if (!isFocused && blockData?.meta?.["frame:bordercolor"]) {
        style.borderColor = blockData.meta["frame:bordercolor"];
    }
    if (isFocused && blockData?.meta?.["frame:bordercolor:focused"]) {
        style.borderColor = blockData.meta["frame:bordercolor:focused"];
    }
    let innerElem = null;
    if (isLayoutMode) {
        innerElem = (
            <div className="block-mask-inner">
                <div className="bignum">
                    <BlockNum blockId={blockId} />
                </div>
            </div>
        );
    }
    return (
        <div className={clsx("block-mask", { "is-layoutmode": isLayoutMode })} style={style}>
            {innerElem}
        </div>
    );
};

const BlockFrame_Default_Component = (props: BlockFrameProps) => {
    const { blockId, layoutModel, viewModel, blockModel, preview, numBlocksInTab, children } = props;
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const isFocusedAtom = useBlockAtom<boolean>(blockId, "isFocused", () => {
        return jotai.atom((get) => {
            const winData = get(atoms.waveWindow);
            return winData?.activeblockid === blockId;
        });
    });
    const viewIconUnion = util.useAtomValueSafe(viewModel.viewIcon) ?? blockViewToIcon(blockData?.meta?.view);
    const customBg = util.useAtomValueSafe(viewModel.blockBg);

    let isFocused = jotai.useAtomValue(isFocusedAtom);
    if (preview) {
        isFocused = true;
    }

    const viewIconElem = getViewIconElem(viewIconUnion, blockData);

    function handleKeyDown(waveEvent: WaveKeyboardEvent): boolean {
        if (checkKeyPressed(waveEvent, "Cmd:m")) {
            layoutModel?.onMagnifyToggle();
            return true;
        }
        if (viewModel?.keyDownHandler) {
            return viewModel.keyDownHandler(waveEvent);
        }
        return false;
    }
    const innerStyle: React.CSSProperties = {};
    if (!preview && customBg?.bg != null) {
        innerStyle.background = customBg.bg;
        if (customBg["bg:opacity"] != null) {
            innerStyle.opacity = customBg["bg:opacity"];
        }
        if (customBg["bg:blendmode"] != null) {
            innerStyle.backgroundBlendMode = customBg["bg:blendmode"];
        }
    }
    const previewElem = <div className="block-frame-preview">{viewIconElem}</div>;
    return (
        <div
            className={clsx(
                "block",
                "block-frame-default",
                isFocused ? "block-focused" : null,
                preview ? "block-preview" : null,
                numBlocksInTab == 1 ? "block-no-highlight" : null,
                "block-" + blockId
            )}
            onClick={blockModel?.onClick}
            onFocusCapture={blockModel?.onFocusCapture}
            ref={blockModel?.blockRef}
            onKeyDown={keydownWrapper(handleKeyDown)}
        >
            <BlockMask blockId={blockId} preview={preview} isFocused={isFocused} />
            <div className="block-frame-default-inner" style={innerStyle}>
                <BlockFrame_Header {...props} />
                {preview ? previewElem : children}
            </div>
        </div>
    );
};

const BlockFrame_Default = React.memo(BlockFrame_Default_Component) as typeof BlockFrame_Default_Component;

const BlockFrame = React.memo((props: BlockFrameProps) => {
    const blockId = props.blockId;
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const tabData = jotai.useAtomValue(atoms.tabAtom);

    if (!blockId || !blockData) {
        return null;
    }
    let FrameElem = BlockFrame_Default;
    const numBlocks = tabData?.blockids?.length ?? 0;
    return <FrameElem {...props} numBlocksInTab={numBlocks} />;
});

export { BlockFrame };
