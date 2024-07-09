// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ErrorBoundary } from "@/element/errorboundary";
import { CenteredDiv } from "@/element/quickelems";
import { ContextMenuModel } from "@/store/contextmenu";
import { atoms, globalStore, setBlockFocus, useBlockAtom } from "@/store/global";
import * as services from "@/store/services";
import * as WOS from "@/store/wos";
import * as util from "@/util/util";
import { CodeEdit } from "@/view/codeedit";
import { PlotView } from "@/view/plotview";
import { PreviewView, makePreviewModel } from "@/view/preview";
import { TerminalView } from "@/view/term/term";
import { WaveAi } from "@/view/waveai";
import { WebView } from "@/view/webview";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";

import "./block.less";

interface LayoutComponentModel {
    onClose?: () => void;
    dragHandleRef?: React.RefObject<HTMLDivElement>;
}

interface BlockProps {
    blockId: string;
    preview: boolean;
    layoutModel: LayoutComponentModel;
}

interface BlockComponentModel {
    onClick?: () => void;
    onFocusCapture?: React.FocusEventHandler<HTMLDivElement>;
    blockRef?: React.RefObject<HTMLDivElement>;
}

interface BlockFrameProps {
    blockId: string;
    blockModel?: BlockComponentModel;
    layoutModel?: LayoutComponentModel;
    viewModel?: ViewModel;
    preview: boolean;
    numBlocksInTab?: number;
    children?: React.ReactNode;
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

function getBlockHeaderIcon(blockIcon: string, blockData: Block): React.ReactNode {
    let blockIconElem: React.ReactNode = null;
    if (util.isBlank(blockIcon)) {
        blockIcon = "square";
    }
    let iconColor = blockData?.meta?.["icon:color"];
    if (iconColor && !iconColor.match(colorRegex)) {
        iconColor = null;
    }
    let iconStyle = null;
    if (!util.isBlank(iconColor)) {
        iconStyle = { color: iconColor };
    }
    const iconClass = util.makeIconClass(blockIcon, true);
    if (iconClass != null) {
        blockIconElem = <i key="icon" style={iconStyle} className={clsx(`block-frame-icon`, iconClass)} />;
    }
    return blockIconElem;
}

function getBlockHeaderText(blockIcon: string, blockData: Block, settings: SettingsConfigType): React.ReactNode {
    if (!blockData) {
        return "no block data";
    }
    let blockIdStr = "";
    if (settings?.blockheader?.showblockids) {
        blockIdStr = ` [${blockData.oid.substring(0, 8)}]`;
    }
    let blockIconElem = getBlockHeaderIcon(blockIcon, blockData);
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

function handleHeaderContextMenu(
    e: React.MouseEvent<HTMLDivElement>,
    blockData: Block,
    viewModel: ViewModel,
    onClose: () => void
) {
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
        label: "Minimize",
        click: () => {
            alert("Not Implemented");
        },
    });
    menu.push({
        label: "Move to New Window",
        click: () => {
            let currentTabId = globalStore.get(atoms.activeTabId);
            try {
                services.WindowService.MoveBlockToNewWindow(currentTabId, blockData.oid);
            } catch (e) {
                console.error("error moving block to new window", e);
            }
        },
    });
    menu.push({ type: "separator" });
    menu.push({
        label: "Copy BlockId",
        click: () => {
            navigator.clipboard.writeText(blockData.oid);
        },
    });
    const extraItems = viewModel?.getSettingsMenuItems?.();
    if (extraItems && extraItems.length > 0) {
        menu.push({ type: "separator" });
        menu.push(...extraItems);
    }
    menu.push({ type: "separator" });
    menu.push({
        label: "Close Block",
        click: onClose,
    });
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
    const viewIcon = jotai.useAtomValue(viewModel.viewIcon);
    const viewText = jotai.useAtomValue(viewModel.viewText);
    const preIconButton = jotai.useAtomValue(viewModel.preIconButton);
    const endIconButtons = jotai.useAtomValue(viewModel.endIconButtons);
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
    let preIconButtonElem: JSX.Element = null;
    if (preIconButton) {
        preIconButtonElem = (
            <div className="block-frame-preicon-button" title={preIconButton.title} onClick={preIconButton.click}>
                <i className={util.makeIconClass(preIconButton.icon, true)} />
            </div>
        );
    }
    let endIconsElem: JSX.Element[] = [];
    if (endIconButtons && endIconButtons.length > 0) {
        for (let idx = 0; idx < endIconButtons.length; idx++) {
            const button = endIconButtons[idx];
            endIconsElem.push(
                <div key={idx} className="block-frame-endicon-button" title={button.title} onClick={button.click}>
                    <i className={util.makeIconClass(button.icon, true)} />
                </div>
            );
        }
    }
    endIconsElem.push(
        <div
            key="settings"
            className="block-frame-endicon-button block-frame-settings"
            onClick={(e) => handleHeaderContextMenu(e, blockData, viewModel, layoutModel?.onClose)}
        >
            <i className="fa fa-solid fa-cog fa-fw" />
        </div>
    );
    endIconsElem.push(
        <div
            key="close"
            className={clsx("block-frame-endicon-button block-frame-default-close")}
            onClick={layoutModel?.onClose}
        >
            <i className="fa fa-solid fa-xmark-large fa-fw" />
        </div>
    );
    return (
        <div
            className={clsx(
                "block",
                "block-frame-default",
                isFocused ? "block-focused" : null,
                preview ? "block-preview" : null,
                numBlocksInTab == 1 ? "block-no-highlight" : null
            )}
            onClick={blockModel?.onClick}
            onFocusCapture={blockModel?.onFocusCapture}
            ref={blockModel?.blockRef}
            style={style}
        >
            <div className="block-mask"></div>
            <div className="block-frame-default-inner">
                <div
                    className="block-frame-default-header"
                    ref={layoutModel?.dragHandleRef}
                    onContextMenu={(e) => handleHeaderContextMenu(e, blockData, viewModel, layoutModel?.onClose)}
                >
                    <div className="block-frame-default-header-iconview">
                        {preIconButtonElem}
                        <div className="block-frame-view-icon">{getBlockHeaderIcon(viewIcon, blockData)}</div>
                        <div className="block-frame-view-type">{blockViewToName(blockData?.view)}</div>
                        {settingsConfig?.blockheader?.showblockids && (
                            <div className="block-frame-blockid">[{blockId.substring(0, 8)}]</div>
                        )}
                    </div>
                    {util.isBlank(viewText) ? null : <div className="block-frame-text">{viewText}</div>}
                    <div className="flex-spacer"></div>
                    <div className="block-frame-end-icons">{endIconsElem}</div>
                </div>
                {preview ? <div className="block-frame-preview" /> : children}
            </div>
        </div>
    );
};

const BlockFrame_Default = React.memo(BlockFrame_Default_Component) as typeof BlockFrame_Default_Component;

const BlockFrame = React.memo((props: BlockFrameProps) => {
    const blockId = props.blockId;
    const [blockData, blockDataLoading] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const tabData = jotai.useAtomValue(atoms.tabAtom);

    if (!blockId || !blockData) {
        return null;
    }
    let FrameElem = BlockFrame_Default;
    const numBlocks = tabData?.blockids?.length ?? 0;
    return <FrameElem {...props} numBlocksInTab={numBlocks} />;
});

function blockViewToIcon(view: string): string {
    console.log("blockViewToIcon", view);
    if (view == "term") {
        return "terminal";
    }
    if (view == "preview") {
        return "file";
    }
    if (view == "web") {
        return "globe";
    }
    if (view == "waveai") {
        return "sparkles";
    }
    return null;
}

function blockViewToName(view: string): string {
    if (view == "term") {
        return "Terminal";
    }
    if (view == "preview") {
        return "Preview";
    }
    if (view == "web") {
        return "Web";
    }
    if (view == "waveai") {
        return "WaveAI";
    }
    return view;
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

function getViewElemAndModel(
    blockId: string,
    blockView: string,
    blockRef: React.RefObject<HTMLDivElement>
): { viewModel: ViewModel; viewElem: JSX.Element } {
    if (blockView == null) {
        return { viewElem: null, viewModel: null };
    }
    let viewElem: JSX.Element = null;
    let viewModel: ViewModel = null;
    if (blockView === "term") {
        viewElem = <TerminalView key={blockId} blockId={blockId} />;
    } else if (blockView === "preview") {
        const previewModel = makePreviewModel(blockId);
        viewElem = <PreviewView key={blockId} blockId={blockId} model={previewModel} />;
        viewModel = previewModel;
    } else if (blockView === "plot") {
        viewElem = <PlotView key={blockId} />;
    } else if (blockView === "codeedit") {
        viewElem = <CodeEdit key={blockId} text={null} filename={null} />;
    } else if (blockView === "web") {
        viewElem = <WebView key={blockId} blockId={blockId} parentRef={blockRef} />;
    } else if (blockView === "waveai") {
        viewElem = <WaveAi key={blockId} parentRef={blockRef} />;
    }
    if (viewModel == null) {
        viewModel = makeDefaultViewModel(blockId);
    }
    return { viewElem, viewModel };
}

function makeDefaultViewModel(blockId: string): ViewModel {
    const blockDataAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
    let viewModel: ViewModel = {
        viewIcon: jotai.atom((get) => {
            const blockData = get(blockDataAtom);
            return blockViewToIcon(blockData?.view);
        }),
        viewName: jotai.atom((get) => {
            const blockData = get(blockDataAtom);
            return blockViewToName(blockData?.view);
        }),
        viewText: jotai.atom((get) => {
            const blockData = get(blockDataAtom);
            return blockData?.meta?.title;
        }),
        preIconButton: jotai.atom(null),
        endIconButtons: jotai.atom(null),
        hasSearch: jotai.atom(false),
    };
    return viewModel;
}

const BlockPreview = React.memo(({ blockId, layoutModel }: BlockProps) => {
    const [blockData, blockDataLoading] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    if (!blockData) {
        return null;
    }
    let { viewModel } = getViewElemAndModel(blockId, blockData?.view, null);
    return (
        <BlockFrame
            key={blockId}
            blockId={blockId}
            layoutModel={layoutModel}
            preview={true}
            blockModel={null}
            viewModel={viewModel}
        />
    );
});

const BlockFull = React.memo(({ blockId, layoutModel }: BlockProps) => {
    const focusElemRef = React.useRef<HTMLInputElement>(null);
    const blockRef = React.useRef<HTMLDivElement>(null);
    const [blockClicked, setBlockClicked] = React.useState(false);
    const [blockData, blockDataLoading] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const [focusedChild, setFocusedChild] = React.useState(null);
    const isFocusedAtom = useBlockAtom<boolean>(blockId, "isFocused", () => {
        return jotai.atom((get) => {
            const winData = get(atoms.waveWindow);
            return winData.activeblockid === blockId;
        });
    });
    let isFocused = jotai.useAtomValue(isFocusedAtom);

    React.useLayoutEffect(() => {
        setBlockClicked(isFocused);
    }, [isFocused]);

    React.useLayoutEffect(() => {
        if (!blockClicked) {
            return;
        }
        setBlockClicked(false);
        const focusWithin = blockRef.current?.contains(document.activeElement);
        if (!focusWithin) {
            setFocusTarget();
        }
        setBlockFocus(blockId);
    }, [blockClicked]);

    React.useLayoutEffect(() => {
        if (focusedChild == null) {
            return;
        }
        setBlockFocus(blockId);
    }, [focusedChild, blockId]);

    // treat the block as clicked on creation
    const setBlockClickedTrue = React.useCallback(() => {
        setBlockClicked(true);
    }, []);

    const determineFocusedChild = React.useCallback(
        (event: React.FocusEvent<HTMLDivElement, Element>) => {
            setFocusedChild(event.target);
        },
        [setFocusedChild]
    );

    const getFocusableChildren = React.useCallback(() => {
        if (blockRef.current == null) {
            return [];
        }
        return Array.from(
            blockRef.current.querySelectorAll(
                'a[href], area[href], input:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex="0"]'
            )
        ).filter((elem) => elem.id != `${blockId}-dummy-focus`);
    }, [blockRef.current]);

    const setFocusTarget = React.useCallback(() => {
        const focusableChildren = getFocusableChildren();
        if (focusableChildren.length == 0) {
            focusElemRef.current.focus({ preventScroll: true });
        } else {
            (focusableChildren[0] as HTMLElement).focus({ preventScroll: true });
        }
    }, [focusElemRef.current, getFocusableChildren]);

    let { viewElem, viewModel } = React.useMemo(
        () => getViewElemAndModel(blockId, blockData?.view, blockRef),
        [blockId, blockData?.view, blockRef]
    );

    if (!blockId || !blockData) return null;

    if (blockDataLoading) {
        viewElem = <CenteredDiv>Loading...</CenteredDiv>;
    }
    const blockModel: BlockComponentModel = {
        onClick: setBlockClickedTrue,
        onFocusCapture: determineFocusedChild,
        blockRef: blockRef,
    };

    return (
        <BlockFrame
            key={blockId}
            blockId={blockId}
            layoutModel={layoutModel}
            preview={false}
            blockModel={blockModel}
            viewModel={viewModel}
        >
            <div key="focuselem" className="block-focuselem">
                <input
                    type="text"
                    value=""
                    ref={focusElemRef}
                    id={`${blockId}-dummy-focus`}
                    onChange={() => {}}
                    disabled={getFocusableChildren().length > 0}
                />
            </div>
            <div key="content" className="block-content">
                <ErrorBoundary>
                    <React.Suspense fallback={<CenteredDiv>Loading...</CenteredDiv>}>{viewElem}</React.Suspense>
                </ErrorBoundary>
            </div>
        </BlockFrame>
    );
});

const Block = React.memo((props: BlockProps) => {
    if (props.preview) {
        return <BlockPreview {...props} />;
    }
    return <BlockFull {...props} />;
});

export { Block };
