// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useLongClick } from "@/app/hook/useLongClick";
import { Button } from "@/element/button";
import { ErrorBoundary } from "@/element/errorboundary";
import { CenteredDiv } from "@/element/quickelems";
import { ContextMenuModel } from "@/store/contextmenu";
import { atoms, globalStore, setBlockFocus, useBlockAtom } from "@/store/global";
import * as services from "@/store/services";
import * as WOS from "@/store/wos";
import * as util from "@/util/util";
import { CpuPlotView, makeCpuPlotViewModel } from "@/view/cpuplot";
import { PlotView } from "@/view/plotview";
import { PreviewView, makePreviewModel } from "@/view/preview";
import { TerminalView, makeTerminalModel } from "@/view/term/term";
import { WaveAi, makeWaveAiViewModel } from "@/view/waveai";
import { WebView, makeWebViewModel } from "@/view/webview";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";

import "./block.less";

export interface LayoutComponentModel {
    disablePointerEvents: boolean;
    onClose?: () => void;
    onMagnifyToggle?: () => void;
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
    let viewString = blockData?.meta?.view;
    if (blockData?.meta?.controller == "cmd") {
        viewString = "cmd";
    }
    return [blockIconElem, viewString + blockIdStr];
}

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
            label: "Minimize",
            click: () => {
                alert("Not Implemented");
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

const IconButton = React.memo(({ decl, className }: { decl: HeaderIconButton; className?: string }) => {
    const buttonRef = React.useRef<HTMLDivElement>(null);
    useLongClick(buttonRef, decl.click, decl.longClick);
    return (
        <div ref={buttonRef} className={clsx(className)} title={decl.title}>
            <i className={util.makeIconClass(decl.icon, true)} />
        </div>
    );
});

const Input = React.memo(({ decl, className }: { decl: HeaderInput; className: string }) => {
    const { value, ref, isDisabled, onChange, onKeyDown, onFocus, onBlur } = decl;
    return (
        <div className="input-wrapper">
            <input
                ref={ref}
                disabled={isDisabled}
                className={className}
                value={value}
                onChange={(e) => onChange(e)}
                onKeyDown={(e) => onKeyDown(e)}
                onFocus={(e) => onFocus(e)}
                onBlur={(e) => onBlur(e)}
            />
        </div>
    );
});

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

function blockViewToIcon(view: string): string {
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
    return "square";
}

function blockViewToName(view: string): string {
    if (util.isBlank(view)) {
        return "(No View)";
    }
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

function getViewElemAndModel(
    blockId: string,
    blockView: string,
    blockRef: React.RefObject<HTMLDivElement>
): { viewModel: ViewModel; viewElem: JSX.Element } {
    let viewElem: JSX.Element = null;
    let viewModel: ViewModel = null;
    if (util.isBlank(blockView)) {
        viewElem = <CenteredDiv>No View</CenteredDiv>;
        viewModel = makeDefaultViewModel(blockId);
    } else if (blockView === "term") {
        const termViewModel = makeTerminalModel(blockId);
        viewElem = <TerminalView key={blockId} blockId={blockId} model={termViewModel} />;
        viewModel = termViewModel;
    } else if (blockView === "preview") {
        const previewModel = makePreviewModel(blockId);
        viewElem = <PreviewView key={blockId} blockId={blockId} model={previewModel} />;
        viewModel = previewModel;
    } else if (blockView === "plot") {
        viewElem = <PlotView key={blockId} />;
    } else if (blockView === "web") {
        const webviewModel = makeWebViewModel(blockId);
        viewElem = <WebView key={blockId} parentRef={blockRef} model={webviewModel} />;
        viewModel = webviewModel;
    } else if (blockView === "waveai") {
        const waveAiModel = makeWaveAiViewModel(blockId);
        viewElem = <WaveAi key={blockId} model={waveAiModel} />;
        viewModel = waveAiModel;
    } else if (blockView === "cpuplot") {
        const cpuPlotModel = makeCpuPlotViewModel(blockId);
        viewElem = <CpuPlotView key={blockId} model={cpuPlotModel} />;
        viewModel = cpuPlotModel;
    }
    if (viewModel == null) {
        viewElem = <CenteredDiv>Invalid View "{blockView}"</CenteredDiv>;
        viewModel = makeDefaultViewModel(blockId);
    }
    return { viewElem, viewModel };
}

function makeDefaultViewModel(blockId: string): ViewModel {
    const blockDataAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
    let viewModel: ViewModel = {
        viewIcon: jotai.atom((get) => {
            const blockData = get(blockDataAtom);
            return blockViewToIcon(blockData?.meta?.view);
        }),
        viewName: jotai.atom((get) => {
            const blockData = get(blockDataAtom);
            return blockViewToName(blockData?.meta?.view);
        }),
        viewText: jotai.atom((get) => {
            const blockData = get(blockDataAtom);
            return blockData?.meta?.title;
        }),
        preIconButton: jotai.atom(null),
        endIconButtons: jotai.atom(null),
    };
    return viewModel;
}

const BlockPreview = React.memo(({ blockId, layoutModel }: BlockProps) => {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    if (!blockData) {
        return null;
    }
    let { viewModel } = getViewElemAndModel(blockId, blockData?.meta?.view, null);
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
    const isFocused = jotai.useAtomValue(isFocusedAtom);

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

    let { viewElem, viewModel } = React.useMemo(
        () => getViewElemAndModel(blockId, blockData?.meta?.view, blockRef),
        [blockId, blockData?.meta?.view, blockRef]
    );

    const determineFocusedChild = React.useCallback(
        (event: React.FocusEvent<HTMLDivElement, Element>) => {
            setFocusedChild(event.target);
        },
        [setFocusedChild]
    );

    const setFocusTarget = React.useCallback(() => {
        const ok = viewModel?.giveFocus?.();
        if (ok) {
            return;
        }
        focusElemRef.current?.focus({ preventScroll: true });
    }, []);

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
                <input type="text" value="" ref={focusElemRef} id={`${blockId}-dummy-focus`} onChange={() => {}} />
            </div>
            <div
                key="content"
                className="block-content"
                style={{ pointerEvents: layoutModel?.disablePointerEvents ? "none" : undefined }}
            >
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
