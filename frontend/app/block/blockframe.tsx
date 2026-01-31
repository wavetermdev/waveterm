// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockModel } from "@/app/block/block-model";
import {
    blockViewToIcon,
    blockViewToName,
    ConnectionButton,
    getBlockHeaderIcon,
    Input,
    ShellButton,
} from "@/app/block/blockutil";
import { Button } from "@/app/element/button";
import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { ChangeConnectionBlockModal } from "@/app/modals/conntypeahead";
import { ShellSelectorModal } from "@/app/modals/shellselector";
import { ContextMenuModel } from "@/app/store/contextmenu";
import {
    atoms,
    getBlockComponentModel,
    getConnStatusAtom,
    getSettingsKeyAtom,
    globalStore,
    recordTEvent,
    useBlockAtom,
    WOS,
} from "@/app/store/global";
import { useTabModel } from "@/app/store/tab-model";
import { uxCloseBlock } from "@/app/store/keymodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { ErrorBoundary } from "@/element/errorboundary";
import { IconButton, ToggleIconButton } from "@/element/iconbutton";
import { MagnifyIcon } from "@/element/magnify";
import { MenuButton } from "@/element/menubutton";
import { NodeModel } from "@/layout/index";
import * as util from "@/util/util";
import { makeIconClass } from "@/util/util";
import { computeBgStyleFromMeta } from "@/util/waveutil";
import clsx from "clsx";
import * as jotai from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import * as React from "react";
import { CopyButton } from "../element/copybutton";
import { BlockFrameProps } from "./blocktypes";

const NumActiveConnColors = 8;

function handleHeaderContextMenu(
    e: React.MouseEvent<HTMLDivElement>,
    blockData: Block,
    viewModel: ViewModel,
    magnified: boolean,
    onMagnifyToggle: () => void
) {
    e.preventDefault();
    e.stopPropagation();
    let menu: ContextMenuItem[] = [
        {
            label: magnified ? "Un-Magnify Block" : "Magnify Block",
            click: () => {
                onMagnifyToggle();
            },
        },
        // {
        //     label: "Move to New Window",
        //     click: () => {
        //         const currentTabId = globalStore.get(atoms.staticTabId);
        //         try {
        //             services.WindowService.MoveBlockToNewWindow(currentTabId, blockData.oid);
        //         } catch (e) {
        //             console.error("error moving block to new window", e);
        //         }
        //     },
        // },
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
            click: () => uxCloseBlock(blockData.oid),
        }
    );
    ContextMenuModel.showContextMenu(menu, e);
}

function getViewIconElem(
    viewIconUnion: string | IconButtonDecl,
    blockData: Block,
    iconColor?: string
): React.ReactElement {
    if (viewIconUnion == null || typeof viewIconUnion === "string") {
        const viewIcon = viewIconUnion as string;
        const style: React.CSSProperties = iconColor ? { color: iconColor, opacity: 1.0 } : {};
        return (
            <div className="block-frame-view-icon" style={style}>
                {getBlockHeaderIcon(viewIcon, blockData)}
            </div>
        );
    } else {
        return <IconButton decl={viewIconUnion} className="block-frame-view-icon" />;
    }
}

const OptMagnifyButton = React.memo(
    ({ magnified, toggleMagnify, disabled }: { magnified: boolean; toggleMagnify: () => void; disabled: boolean }) => {
        const magnifyDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: <MagnifyIcon enabled={magnified} />,
            title: magnified ? "Minimize" : "Magnify",
            click: toggleMagnify,
            disabled,
        };
        return <IconButton key="magnify" decl={magnifyDecl} className="block-frame-magnify" />;
    }
);

function computeEndIcons(
    viewModel: ViewModel,
    nodeModel: NodeModel,
    onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void
): React.ReactElement[] {
    const endIconsElem: React.ReactElement[] = [];
    const endIconButtons = util.useAtomValueSafe(viewModel?.endIconButtons);
    const magnified = jotai.useAtomValue(nodeModel.isMagnified);
    const ephemeral = jotai.useAtomValue(nodeModel.isEphemeral);
    const numLeafs = jotai.useAtomValue(nodeModel.numLeafs);
    const magnifyDisabled = numLeafs <= 1;

    if (endIconButtons && endIconButtons.length > 0) {
        endIconsElem.push(...endIconButtons.map((button, idx) => <IconButton key={idx} decl={button} />));
    }
    const settingsDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "cog",
        title: "Settings",
        click: onContextMenu,
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
    return endIconsElem;
}

const BlockFrame_Header = ({
    nodeModel,
    viewModel,
    preview,
    connBtnRef,
    changeConnModalAtom,
    shellBtnRef,
    changeShellModalAtom,
    error,
}: BlockFrameProps & {
    changeConnModalAtom: jotai.PrimitiveAtom<boolean>;
    shellBtnRef: React.RefObject<HTMLDivElement>;
    changeShellModalAtom: jotai.PrimitiveAtom<boolean>;
    error?: Error;
}) => {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", nodeModel.blockId));
    let viewName = util.useAtomValueSafe(viewModel?.viewName) ?? blockViewToName(blockData?.meta?.view);
    const showBlockIds = jotai.useAtomValue(getSettingsKeyAtom("blockheader:showblockids"));
    let viewIconUnion = util.useAtomValueSafe(viewModel?.viewIcon) ?? blockViewToIcon(blockData?.meta?.view);
    const viewIconColor = util.useAtomValueSafe(viewModel?.viewIconColor);
    const preIconButton = util.useAtomValueSafe(viewModel?.preIconButton);
    let headerTextUnion = util.useAtomValueSafe(viewModel?.viewText);
    const magnified = jotai.useAtomValue(nodeModel.isMagnified);
    const prevMagifiedState = React.useRef(magnified);
    const manageConnection = util.useAtomValueSafe(viewModel?.manageConnection);
    const dragHandleRef = preview ? null : nodeModel.dragHandleRef;
    const connName = blockData?.meta?.connection;
    const shellProfile = blockData?.meta?.["shell:profile"] || "";
    const connStatus = util.useAtomValueSafe(getConnStatusAtom(connName));
    const wshProblem = connName && !connStatus?.wshenabled && connStatus?.status == "connected";
    const fullConfig = jotai.useAtomValue(atoms.fullConfigAtom);

    // Determine if this is a local connection (no connection or local)
    // For local connections in terminals, show ShellButton instead of ConnectionButton
    const isLocalConn = util.isLocalConnection(connName, fullConfig?.connections);

    React.useEffect(() => {
        if (!magnified || preview || prevMagifiedState.current) {
            return;
        }
        RpcApi.ActivityCommand(TabRpcClient, { nummagnify: 1 });
        recordTEvent("action:magnify", { "block:view": viewName });
    }, [magnified]);

    if (blockData?.meta?.["frame:title"]) {
        viewName = blockData.meta["frame:title"];
    }
    if (blockData?.meta?.["frame:icon"]) {
        viewIconUnion = blockData.meta["frame:icon"];
    }
    if (blockData?.meta?.["frame:text"]) {
        headerTextUnion = blockData.meta["frame:text"];
    }

    const onContextMenu = React.useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            handleHeaderContextMenu(e, blockData, viewModel, magnified, nodeModel.toggleMagnify);
        },
        [magnified]
    );

    const endIconsElem = computeEndIcons(viewModel, nodeModel, onContextMenu);
    const viewIconElem = getViewIconElem(viewIconUnion, blockData, viewIconColor);
    let preIconButtonElem: React.ReactElement = null;
    if (preIconButton) {
        preIconButtonElem = <IconButton decl={preIconButton} className="block-frame-preicon-button" />;
    }

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
    const wshInstallButton: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "link-slash",
        title: "wsh is not installed for this connection",
    };
    const showNoWshButton = manageConnection && wshProblem && !util.isLocalConnName(connName);

    return (
        <div
            className="block-frame-default-header"
            data-role="block-header"
            ref={dragHandleRef}
            onContextMenu={onContextMenu}
        >
            {preIconButtonElem}
            <div className="block-frame-default-header-iconview">
                {viewIconElem}
                <div className="block-frame-view-type">{viewName}</div>
                {showBlockIds && <div className="block-frame-blockid">[{nodeModel.blockId.substring(0, 8)}]</div>}
            </div>
            {manageConnection && isLocalConn && (
                <ShellButton
                    ref={shellBtnRef}
                    key="shellbutton"
                    shellProfile={shellProfile}
                    changeShellModalAtom={changeShellModalAtom}
                />
            )}
            {manageConnection && !isLocalConn && (
                <ConnectionButton
                    ref={connBtnRef}
                    key="connbutton"
                    connection={blockData?.meta?.connection}
                    changeConnModalAtom={changeConnModalAtom}
                />
            )}
            {showNoWshButton && <IconButton decl={wshInstallButton} className="block-frame-header-iconbutton" />}
            <div className="block-frame-textelems-wrapper">{headerTextElems}</div>
            <div className="block-frame-end-icons">{endIconsElem}</div>
        </div>
    );
};

const HeaderTextElem = React.memo(({ elem, preview }: { elem: HeaderElem; preview: boolean }) => {
    if (elem.elemtype == "iconbutton") {
        return <IconButton decl={elem} className={clsx("block-frame-header-iconbutton", elem.className)} />;
    } else if (elem.elemtype == "toggleiconbutton") {
        return <ToggleIconButton decl={elem} className={clsx("block-frame-header-iconbutton", elem.className)} />;
    } else if (elem.elemtype == "input") {
        return <Input decl={elem} className={clsx("block-frame-input", elem.className)} preview={preview} />;
    } else if (elem.elemtype == "text") {
        return (
            <div className={clsx("block-frame-text ellipsis", elem.className, { "flex-nogrow": elem.noGrow })}>
                <span ref={preview ? null : elem.ref} onClick={(e) => elem?.onClick(e)}>
                    &lrm;{elem.text}
                </span>
            </div>
        );
    } else if (elem.elemtype == "textbutton") {
        return (
            <Button className={elem.className} onClick={(e) => elem.onClick(e)} title={elem.title}>
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
                    <HeaderTextElem elem={child} key={childIdx} preview={preview} />
                ))}
            </div>
        );
    } else if (elem.elemtype == "menubutton") {
        return <MenuButton className="block-frame-menubutton" {...(elem as MenuButtonProps)} />;
    }
    return null;
});

function renderHeaderElements(headerTextUnion: HeaderElem[], preview: boolean): React.ReactElement[] {
    const headerTextElems: React.ReactElement[] = [];
    for (let idx = 0; idx < headerTextUnion.length; idx++) {
        const elem = headerTextUnion[idx];
        const renderedElement = <HeaderTextElem elem={elem} key={idx} preview={preview} />;
        if (renderedElement) {
            headerTextElems.push(renderedElement);
        }
    }
    return headerTextElems;
}

const ConnStatusOverlay = React.memo(
    ({
        nodeModel,
        viewModel,
        changeConnModalAtom,
    }: {
        nodeModel: NodeModel;
        viewModel: ViewModel;
        changeConnModalAtom: jotai.PrimitiveAtom<boolean>;
    }) => {
        const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", nodeModel.blockId));
        const [connModalOpen] = jotai.useAtom(changeConnModalAtom);
        const connName = blockData.meta?.connection;
        const connStatus = jotai.useAtomValue(getConnStatusAtom(connName));
        const isLayoutMode = jotai.useAtomValue(atoms.controlShiftDelayAtom);
        const [overlayRefCallback, _, domRect] = useDimensionsWithCallbackRef(30);
        const width = domRect?.width;
        const [showError, setShowError] = React.useState(false);
        const fullConfig = jotai.useAtomValue(atoms.fullConfigAtom);
        const [showWshError, setShowWshError] = React.useState(false);

        React.useEffect(() => {
            if (width) {
                const hasError = !util.isBlank(connStatus.error);
                const showError = hasError && width >= 250 && connStatus.status == "error";
                setShowError(showError);
            }
        }, [width, connStatus, setShowError]);

        const handleTryReconnect = React.useCallback(() => {
            const prtn = RpcApi.ConnConnectCommand(
                TabRpcClient,
                { host: connName, logblockid: nodeModel.blockId },
                { timeout: 60000 }
            );
            prtn.catch((e) => console.log("error reconnecting", connName, e));
        }, [connName]);

        const handleDisableWsh = React.useCallback(async () => {
            // using unknown is a hack. we need proper types for the
            // connection config on the frontend
            const metamaptype: unknown = {
                "conn:wshenabled": false,
            };
            const data: ConnConfigRequest = {
                host: connName,
                metamaptype: metamaptype,
            };
            try {
                await RpcApi.SetConnectionsConfigCommand(TabRpcClient, data);
            } catch (e) {
                console.log("problem setting connection config: ", e);
            }
        }, [connName]);

        const handleRemoveWshError = React.useCallback(async () => {
            try {
                await RpcApi.DismissWshFailCommand(TabRpcClient, connName);
            } catch (e) {
                console.log("unable to dismiss wsh error: ", e);
            }
        }, [connName]);

        let statusText = `Disconnected from "${connName}"`;
        let showReconnect = true;
        if (connStatus.status == "connecting") {
            statusText = `Connecting to "${connName}"...`;
            showReconnect = false;
        }
        if (connStatus.status == "connected") {
            showReconnect = false;
        }
        let reconDisplay = null;
        let reconClassName = "outlined grey";
        if (width && width < 350) {
            reconDisplay = <i className="fa-sharp fa-solid fa-rotate-right"></i>;
            reconClassName = clsx(reconClassName, "text-[12px] py-[5px] px-[6px]");
        } else {
            reconDisplay = "Reconnect";
            reconClassName = clsx(reconClassName, "text-[11px] py-[3px] px-[7px]");
        }
        const showIcon = connStatus.status != "connecting";

        const wshConfigEnabled = fullConfig?.connections?.[connName]?.["conn:wshenabled"] ?? true;
        React.useEffect(() => {
            const showWshErrorTemp =
                connStatus.status == "connected" &&
                connStatus.wsherror &&
                connStatus.wsherror != "" &&
                wshConfigEnabled;

            setShowWshError(showWshErrorTemp);
        }, [connStatus, wshConfigEnabled]);

        const handleCopy = React.useCallback(
            async (e: React.MouseEvent) => {
                const errTexts = [];
                if (showError) {
                    errTexts.push(`error: ${connStatus.error}`);
                }
                if (showWshError) {
                    errTexts.push(`unable to use wsh: ${connStatus.wsherror}`);
                }
                const textToCopy = errTexts.join("\n");
                await navigator.clipboard.writeText(textToCopy);
            },
            [showError, showWshError, connStatus.error, connStatus.wsherror]
        );

        // Don't show overlay for local connections (including local shell profiles)
        // They don't have reconnection semantics like SSH connections
        const isLocalConn = util.isLocalConnection(connName, fullConfig.connections);
        if (isLocalConn) {
            return null;
        }

        if (!showWshError && (isLayoutMode || connStatus.status == "connected" || connModalOpen)) {
            return null;
        }

        return (
            <div className="connstatus-overlay" ref={overlayRefCallback}>
                <div className="connstatus-content">
                    <div className={clsx("connstatus-status-icon-wrapper", { "has-error": showError || showWshError })}>
                        {showIcon && <i className="fa-solid fa-triangle-exclamation"></i>}
                        <div className="connstatus-status ellipsis">
                            <div className="connstatus-status-text">{statusText}</div>
                            {(showError || showWshError) && (
                                <OverlayScrollbarsComponent
                                    className="connstatus-error"
                                    options={{ scrollbars: { autoHide: "leave" } }}
                                >
                                    <CopyButton className="copy-button" onClick={handleCopy} title="Copy" />
                                    {showError ? <div>error: {connStatus.error}</div> : null}
                                    {showWshError ? <div>unable to use wsh: {connStatus.wsherror}</div> : null}
                                </OverlayScrollbarsComponent>
                            )}
                            {showWshError && (
                                <Button className={reconClassName} onClick={handleDisableWsh}>
                                    always disable wsh
                                </Button>
                            )}
                        </div>
                    </div>
                    {showReconnect ? (
                        <div className="connstatus-actions">
                            <Button className={reconClassName} onClick={handleTryReconnect}>
                                {reconDisplay}
                            </Button>
                        </div>
                    ) : null}
                    {showWshError ? (
                        <div className="connstatus-actions">
                            <Button className={`fa-xmark fa-solid ${reconClassName}`} onClick={handleRemoveWshError} />
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }
);

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
    const changeShellModalAtom = useBlockAtom(nodeModel.blockId, "changeShell", () => {
        return jotai.atom(false);
    }) as jotai.PrimitiveAtom<boolean>;
    const shellModalOpen = jotai.useAtomValue(changeShellModalAtom);
    const isMagnified = jotai.useAtomValue(nodeModel.isMagnified);
    const isEphemeral = jotai.useAtomValue(nodeModel.isEphemeral);
    const [magnifiedBlockBlurAtom] = React.useState(() => getSettingsKeyAtom("window:magnifiedblockblurprimarypx"));
    const magnifiedBlockBlur = jotai.useAtomValue(magnifiedBlockBlurAtom);
    const [magnifiedBlockOpacityAtom] = React.useState(() => getSettingsKeyAtom("window:magnifiedblockopacity"));
    const magnifiedBlockOpacity = jotai.useAtomValue(magnifiedBlockOpacityAtom);
    const connBtnRef = React.useRef<HTMLDivElement>(null);
    const shellBtnRef = React.useRef<HTMLDivElement>(null);
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
        <BlockFrame_Header
            {...props}
            connBtnRef={connBtnRef}
            changeConnModalAtom={changeConnModalAtom}
            shellBtnRef={shellBtnRef}
            changeShellModalAtom={changeShellModalAtom}
        />
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
            {preview || viewModel == null ? null : (
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
            {preview || viewModel == null || !shellModalOpen ? null : (
                <ShellSelectorModal
                    blockId={nodeModel.blockId}
                    blockRef={blockModel?.blockRef}
                    shellBtnRef={shellBtnRef}
                    changeShellModalAtom={changeShellModalAtom}
                    nodeModel={nodeModel}
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

export { BlockFrame, NumActiveConnColors };
