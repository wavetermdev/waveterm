// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CodeEdit } from "@/app/view/codeedit";
import { PlotView } from "@/app/view/plotview";
import { PreviewView } from "@/app/view/preview";
import { TerminalView } from "@/app/view/term/term";
import { ErrorBoundary } from "@/element/errorboundary";
import { CenteredDiv } from "@/element/quickelems";
import { ContextMenuModel } from "@/store/contextmenu";
import { atoms, setBlockFocus, useBlockAtom } from "@/store/global";
import * as WOS from "@/store/wos";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";

import "./block.less";

const HoverPixels = 15;
const HoverTimeoutMs = 100;

interface BlockProps {
    blockId: string;
    onClose?: () => void;
    dragHandleRef?: React.RefObject<HTMLDivElement>;
}

const colorRegex = /^((#[0-9a-f]{6,8})|([a-z]+))$/;

function processTitleString(titleString: string): React.ReactNode[] {
    if (titleString == null) {
        return null;
    }
    const tagRegex = /<(\/)?([a-z]+)(?::([#a-z0-9@-]+))?>/g;
    let lastIdx = 0;
    let match;
    let partsStack = [[]];
    while ((match = tagRegex.exec(titleString)) != null) {
        const lastPart = partsStack[partsStack.length - 1];
        const before = titleString.substring(lastIdx, match.index);
        lastPart.push(before);
        lastIdx = match.index + match[0].length;
        const [_, isClosing, tagName, tagParam] = match;
        if (tagName == "icon" && !isClosing) {
            if (tagParam == null) {
                continue;
            }
            const iconClass = util.makeIconClass(tagParam, false);
            if (iconClass == null) {
                continue;
            }
            lastPart.push(<i key={match.index} className={iconClass} />);
            continue;
        }
        if (tagName == "c" || tagName == "color") {
            if (isClosing) {
                if (partsStack.length <= 1) {
                    continue;
                }
                partsStack.pop();
                continue;
            }
            if (tagParam == null) {
                continue;
            }
            if (!tagParam.match(colorRegex)) {
                continue;
            }
            let children = [];
            const rtag = React.createElement("span", { key: match.index, style: { color: tagParam } }, children);
            lastPart.push(rtag);
            partsStack.push(children);
            continue;
        }
        if (tagName == "i" || tagName == "b") {
            if (isClosing) {
                if (partsStack.length <= 1) {
                    continue;
                }
                partsStack.pop();
                continue;
            }
            let children = [];
            const rtag = React.createElement(tagName, { key: match.index }, children);
            lastPart.push(rtag);
            partsStack.push(children);
            continue;
        }
    }
    partsStack[partsStack.length - 1].push(titleString.substring(lastIdx));
    return partsStack[0];
}

function getBlockHeaderText(blockIcon: string, blockData: Block, settings: SettingsConfigType): React.ReactNode {
    if (!blockData) {
        return "no block data";
    }
    let blockIdStr = "";
    if (settings?.blockheader?.showblockids) {
        blockIdStr = ` [${blockData.oid.substring(0, 8)}]`;
    }
    let blockIconElem: React.ReactNode = null;
    if (!util.isBlank(blockIcon)) {
        let iconColor = blockData?.meta?.["icon:color"];
        if (iconColor && !iconColor.match(colorRegex)) {
            iconColor = null;
        }
        let iconStyle = null;
        if (!util.isBlank(iconColor)) {
            iconStyle = { color: iconColor };
        }
        const iconClass = util.makeIconClass(blockIcon, false);
        if (iconClass != null) {
            blockIconElem = <i key="icon" style={iconStyle} className={clsx(`block-frame-icon`, iconClass)} />;
        }
    }
    if (!util.isBlank(blockData?.meta?.title)) {
        try {
            const rtn = processTitleString(blockData.meta.title) ?? [];
            return [blockIconElem, ...rtn, blockIdStr == "" ? null : blockIdStr];
        } catch (e) {
            console.error("error processing title", blockData.meta.title, e);
            return [blockIconElem, blockData.meta.title + blockIdStr];
        }
    }
    let viewString = blockData?.view;
    if (blockData.controller == "cmd") {
        viewString = "cmd";
    }
    return [blockIconElem, viewString + blockIdStr];
}

function handleHeaderContextMenu(e: React.MouseEvent<HTMLDivElement>, blockData: Block, onClose: () => void) {
    e.preventDefault();
    e.stopPropagation();
    let menu: ContextMenuItem[] = [];
    menu.push({
        label: "Focus Block",
        click: () => {
            alert("Not Implemented");
        },
    });
    menu.push({
        label: "Move to New Window",
        click: () => {
            alert("Not Implemented");
        },
    });
    menu.push({ type: "separator" });
    menu.push({
        label: "Copy BlockId",
        click: () => {
            navigator.clipboard.writeText(blockData.oid);
        },
    });
    menu.push({ type: "separator" });
    menu.push({
        label: "Close Block",
        click: onClose,
    });
    ContextMenuModel.showContextMenu(menu, e);
}

interface FramelessBlockHeaderProps {
    blockId: string;
    onClose?: () => void;
    dragHandleRef?: React.RefObject<HTMLDivElement>;
}

const FramelessBlockHeader = ({ blockId, onClose, dragHandleRef }: FramelessBlockHeaderProps) => {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const settingsConfig = jotai.useAtomValue(atoms.settingsConfigAtom);

    return (
        <div key="header" className="block-header" ref={dragHandleRef}>
            <div className="block-header-text text-fixed">{getBlockHeaderText(null, blockData, settingsConfig)}</div>
            {onClose && (
                <div className="close-button" onClick={onClose}>
                    <i className="fa fa-solid fa-xmark-large" />
                </div>
            )}
        </div>
    );
};

const hoverStateOff = "off";
const hoverStatePending = "pending";
const hoverStateOn = "on";

interface BlockFrameProps {
    blockId: string;
    onClose?: () => void;
    onClick?: () => void;
    preview: boolean;
    children?: React.ReactNode;
    blockRef?: React.RefObject<HTMLDivElement>;
    dragHandleRef?: React.RefObject<HTMLDivElement>;
}

const BlockFrame_Tech = ({
    blockId,
    onClose,
    onClick,
    preview,
    blockRef,
    dragHandleRef,
    children,
}: BlockFrameProps) => {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const settingsConfig = jotai.useAtomValue(atoms.settingsConfigAtom);
    const isFocusedAtom = useBlockAtom<boolean>(blockId, "isFocused", () => {
        return jotai.atom((get) => {
            const winData = get(atoms.waveWindow);
            return winData.activeblockid === blockId;
        });
    });
    let isFocused = jotai.useAtomValue(isFocusedAtom);
    const blockIcon = useBlockIcon(blockId);

    if (preview) {
        isFocused = true;
    }
    let style: React.CSSProperties = {};
    if (!isFocused && blockData?.meta?.["frame:bordercolor"]) {
        style.borderColor = blockData.meta["frame:bordercolor"];
    }
    if (isFocused && blockData?.meta?.["frame:bordercolor:focused"]) {
        style.borderColor = blockData.meta["frame:bordercolor:focused"];
    }
    return (
        <div
            className={clsx(
                "block",
                "block-frame-tech",
                isFocused ? "block-focused" : null,
                preview ? "block-preview" : null
            )}
            onClick={onClick}
            ref={blockRef}
            style={style}
        >
            <div
                className="block-frame-tech-header"
                ref={dragHandleRef}
                onContextMenu={(e) => handleHeaderContextMenu(e, blockData, onClose)}
            >
                {getBlockHeaderText(blockIcon, blockData, settingsConfig)}
            </div>
            <div className={clsx("block-frame-tech-close")} onClick={onClose}>
                <i className="fa fa-solid fa-xmark fa-fw" />
            </div>
            {preview ? <div className="block-frame-preview" /> : children}
        </div>
    );
};

const BlockFrame_Frameless = ({
    blockId,
    onClose,
    onClick,
    preview,
    blockRef,
    dragHandleRef,
    children,
}: BlockFrameProps) => {
    const localBlockRef = React.useRef<HTMLDivElement>(null);
    const [showHeader, setShowHeader] = React.useState(preview ? true : false);
    const hoverState = React.useRef(hoverStateOff);

    // this forward the lcal ref to the blockRef
    React.useImperativeHandle(blockRef, () => localBlockRef.current);

    React.useEffect(() => {
        if (preview) {
            return;
        }
        const block = localBlockRef.current;
        let hoverTimeout: NodeJS.Timeout = null;
        const handleMouseMove = (event) => {
            const rect = block.getBoundingClientRect();
            if (event.clientY - rect.top <= HoverPixels) {
                if (hoverState.current == hoverStateOff) {
                    hoverTimeout = setTimeout(() => {
                        if (hoverState.current == hoverStatePending) {
                            hoverState.current = hoverStateOn;
                            setShowHeader(true);
                        }
                    }, HoverTimeoutMs);
                    hoverState.current = hoverStatePending;
                }
            } else {
                if (hoverTimeout) {
                    if (hoverState.current == hoverStatePending) {
                        hoverState.current = hoverStateOff;
                    }
                    clearTimeout(hoverTimeout);
                    hoverTimeout = null;
                }
            }
        };
        block.addEventListener("mousemove", handleMouseMove);
        return () => {
            block.removeEventListener("mousemove", handleMouseMove);
        };
    });
    let mouseLeaveHandler = () => {
        if (preview) {
            return;
        }
        setShowHeader(false);
        hoverState.current = hoverStateOff;
    };
    return (
        <div
            className="block block-frame-frameless"
            ref={localBlockRef}
            onMouseLeave={mouseLeaveHandler}
            onClick={onClick}
        >
            <div
                className={clsx("block-header-animation-wrap", showHeader ? "is-showing" : null)}
                onMouseLeave={mouseLeaveHandler}
            >
                <FramelessBlockHeader blockId={blockId} onClose={onClose} dragHandleRef={dragHandleRef} />
            </div>
            {preview ? <div className="block-frame-preview" /> : children}
        </div>
    );
};

const BlockFrame = (props: BlockFrameProps) => {
    const blockId = props.blockId;
    const [blockData, blockDataLoading] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const tabData = jotai.useAtomValue(atoms.tabAtom);

    if (!blockId || !blockData) {
        return null;
    }
    let FrameElem = BlockFrame_Tech;
    // if 0 or 1 blocks, use frameless, otherwise use tech
    const numBlocks = tabData?.blockids?.length ?? 0;
    if (numBlocks <= 1) {
        FrameElem = BlockFrame_Frameless;
    }
    if (blockData?.meta?.["frame"] === "tech") {
        FrameElem = BlockFrame_Tech;
    } else if (blockData?.meta?.["frame"] === "frameless") {
        FrameElem = BlockFrame_Frameless;
    }
    return <FrameElem {...props} />;
};

function blockViewToIcon(view: string): string {
    console.log("blockViewToIcon", view);
    if (view == "term") {
        return "square-terminal";
    }
    if (view == "preview") {
        return "file";
    }
    return null;
}

function useBlockIcon(blockId: string): string {
    const blockIconOverrideAtom = useBlockAtom<string>(blockId, "blockicon:override", () => {
        return jotai.atom<string>(null);
    });
    const blockIconAtom = useBlockAtom<string>(blockId, "blockicon", () => {
        return jotai.atom((get) => {
            console.log("atom-blockicon", blockId);
            const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
            const blockData = get(blockAtom);
            const metaIcon = blockData?.meta?.icon;
            if (!util.isBlank(metaIcon)) {
                console.log("atom-blockicon-meta", metaIcon);
                return metaIcon;
            }
            const overrideVal = get(blockIconOverrideAtom);
            if (overrideVal != null) {
                return overrideVal;
            }
            return blockViewToIcon(blockData?.view);
        });
    });
    const blockIcon = jotai.useAtomValue(blockIconAtom);
    return blockIcon;
}

const Block = ({ blockId, onClose, dragHandleRef }: BlockProps) => {
    let blockElem: JSX.Element = null;
    const focusElemRef = React.useRef<HTMLInputElement>(null);
    const blockRef = React.useRef<HTMLDivElement>(null);
    const [blockClicked, setBlockClicked] = React.useState(false);
    const [blockData, blockDataLoading] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));

    React.useLayoutEffect(() => {
        if (!blockClicked) {
            return;
        }
        setBlockClicked(false);
        const focusWithin = blockRef.current?.contains(document.activeElement);
        if (!focusWithin) {
            focusElemRef.current?.focus();
        }
        setBlockFocus(blockId);
    }, [blockClicked]);

    if (!blockId || !blockData) return null;
    if (blockDataLoading) {
        blockElem = <CenteredDiv>Loading...</CenteredDiv>;
    } else if (blockData.view === "term") {
        blockElem = <TerminalView blockId={blockId} />;
    } else if (blockData.view === "preview") {
        blockElem = <PreviewView blockId={blockId} />;
    } else if (blockData.view === "plot") {
        blockElem = <PlotView />;
    } else if (blockData.view === "codeedit") {
        blockElem = <CodeEdit text={null} filename={null} />;
    }
    return (
        <BlockFrame
            blockId={blockId}
            onClose={onClose}
            preview={false}
            onClick={() => setBlockClicked(true)}
            blockRef={blockRef}
            dragHandleRef={dragHandleRef}
        >
            <div key="focuselem" className="block-focuselem">
                <input type="text" value="" ref={focusElemRef} onChange={() => {}} />
            </div>
            <div key="content" className="block-content">
                <ErrorBoundary>
                    <React.Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{blockElem}</React.Suspense>
                </ErrorBoundary>
            </div>
        </BlockFrame>
    );
};

export { Block, BlockFrame };
