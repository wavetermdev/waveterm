// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { blockViewToIcon, blockViewToName, getBlockHeaderIcon, IconButton, Input } from "@/app/block/blockutil";
import { Button } from "@/app/element/button";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { atoms, globalStore, useBlockAtom, WOS } from "@/app/store/global";
import * as services from "@/app/store/services";
import { getLayoutStateAtomForTab } from "@/layout/lib/layoutAtom";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import { isBlockMagnified } from "@/util/layoututil";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";
import { BlockFrameProps } from "./blocktypes";

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

const BlockFrame_Default_Component = ({
    blockId,
    layoutModel,
    viewModel,
    blockModel,
    preview,
    numBlocksInTab,
    children,
}: BlockFrameProps) => {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const settingsConfig = jotai.useAtomValue(atoms.settingsConfigAtom);
    const isFocusedAtom = useBlockAtom<boolean>(blockId, "isFocused", () => {
        return jotai.atom((get) => {
            const winData = get(atoms.waveWindow);
            return winData?.activeblockid === blockId;
        });
    });
    let isFocused = jotai.useAtomValue(isFocusedAtom);
    const viewIconUnion = util.useAtomValueSafe(viewModel.viewIcon) ?? blockViewToIcon(blockData?.meta?.view);
    const viewName = util.useAtomValueSafe(viewModel.viewName) ?? blockViewToName(blockData?.meta?.view);
    const headerTextUnion = util.useAtomValueSafe(viewModel.viewText);
    const preIconButton = util.useAtomValueSafe(viewModel.preIconButton);
    const endIconButtons = util.useAtomValueSafe(viewModel.endIconButtons);
    const customBg = util.useAtomValueSafe(viewModel.blockBg);
    const tabId = globalStore.get(atoms.activeTabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
    const layoutTreeState = util.useAtomValueSafe(getLayoutStateAtomForTab(tabId, tabAtom));
    if (preview) {
        isFocused = true;
    }
    const style: React.CSSProperties = {};
    if (!isFocused && blockData?.meta?.["frame:bordercolor"]) {
        style.borderColor = blockData.meta["frame:bordercolor"];
    }
    if (isFocused && blockData?.meta?.["frame:bordercolor:focused"]) {
        style.borderColor = blockData.meta["frame:bordercolor:focused"];
    }
    let viewIconElem: JSX.Element = null;
    if (viewIconUnion == null || typeof viewIconUnion === "string") {
        const viewIcon = viewIconUnion as string;
        viewIconElem = <div className="block-frame-view-icon">{getBlockHeaderIcon(viewIcon, blockData)}</div>;
    } else {
        viewIconElem = <IconButton decl={viewIconUnion} className="block-frame-view-icon" />;
    }
    let preIconButtonElem: JSX.Element = null;
    if (preIconButton) {
        preIconButtonElem = <IconButton decl={preIconButton} className="block-frame-preicon-button" />;
    }
    const endIconsElem: JSX.Element[] = [];
    if (endIconButtons && endIconButtons.length > 0) {
        endIconsElem.push(
            ...endIconButtons.map((button, idx) => (
                <IconButton key={idx} decl={button} className="block-frame-endicon-button" />
            ))
        );
    }
    const settingsDecl: HeaderIconButton = {
        elemtype: "iconbutton",
        icon: "cog",
        title: "Settings",
        click: (e) =>
            handleHeaderContextMenu(e, blockData, viewModel, layoutModel?.onMagnifyToggle, layoutModel?.onClose),
    };
    endIconsElem.push(
        <IconButton key="settings" decl={settingsDecl} className="block-frame-endicon-button block-frame-settings" />
    );
    if (isBlockMagnified(layoutTreeState, blockId)) {
        const magnifyDecl: HeaderIconButton = {
            elemtype: "iconbutton",
            icon: "regular@magnifying-glass-minus",
            title: "Minimize",
            click: layoutModel?.onMagnifyToggle,
        };
        endIconsElem.push(
            <IconButton key="magnify" decl={magnifyDecl} className="block-frame-endicon-button block-frame-magnify" />
        );
    }
    const closeDecl: HeaderIconButton = {
        elemtype: "iconbutton",
        icon: "xmark-large",
        title: "Close",
        click: layoutModel?.onClose,
    };
    endIconsElem.push(
        <IconButton key="close" decl={closeDecl} className="block-frame-endicon-button block-frame-default-close" />
    );

    function renderHeaderElements(headerTextUnion: HeaderElem[]): JSX.Element[] {
        const headerTextElems: JSX.Element[] = [];

        function renderElement(elem: HeaderElem, key: number): JSX.Element {
            if (elem.elemtype == "iconbutton") {
                return (
                    <IconButton
                        key={key}
                        decl={elem}
                        className={clsx("block-frame-header-iconbutton", elem.className)}
                    />
                );
            } else if (elem.elemtype == "input") {
                return <Input key={key} decl={elem} className={clsx("block-frame-input", elem.className)} />;
            } else if (elem.elemtype == "text") {
                return (
                    <div key={key} className="block-frame-text">
                        {elem.text}
                    </div>
                );
            } else if (elem.elemtype == "textbutton") {
                return (
                    <Button key={key} className={elem.className} onClick={(e) => elem.onClick(e)}>
                        {elem.text}
                    </Button>
                );
            } else if (elem.elemtype == "div") {
                return (
                    <div
                        key={key}
                        className={clsx("block-frame-div", elem.className)}
                        onMouseOver={elem.onMouseOver}
                        onMouseOut={elem.onMouseOut}
                    >
                        {elem.children.map((child, childIdx) => renderElement(child, childIdx))}
                    </div>
                );
            }
            return null;
        }

        for (let idx = 0; idx < headerTextUnion.length; idx++) {
            const elem = headerTextUnion[idx];
            const renderedElement = renderElement(elem, idx);
            if (renderedElement) {
                headerTextElems.push(renderedElement);
            }
        }

        return headerTextElems;
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

    function handleDoubleClick() {
        layoutModel?.onMagnifyToggle();
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
        const waveEvent = adaptFromReactOrNativeKeyEvent(e);
        if (checkKeyPressed(waveEvent, "Cmd:m")) {
            e.preventDefault();
            layoutModel?.onMagnifyToggle();
            return;
        }
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
            style={style}
            onKeyDown={handleKeyDown}
        >
            <div className="block-mask"></div>
            <div className="block-frame-default-inner" style={innerStyle}>
                <div
                    className="block-frame-default-header"
                    ref={layoutModel?.dragHandleRef}
                    onDoubleClick={handleDoubleClick}
                    onContextMenu={(e) =>
                        handleHeaderContextMenu(
                            e,
                            blockData,
                            viewModel,
                            layoutModel?.onMagnifyToggle,
                            layoutModel?.onClose
                        )
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
