// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    blockViewToIcon,
    blockViewToName,
    computeConnColorNum,
    ConnectionButton,
    ControllerStatusIcon,
    getBlockHeaderIcon,
    Input,
} from "@/app/block/blockutil";
import { Button } from "@/app/element/button";
import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { TypeAheadModal } from "@/app/modals/typeaheadmodal";
import { ContextMenuModel } from "@/app/store/contextmenu";
import {
    atoms,
    getBlockComponentModel,
    getConnStatusAtom,
    getHostName,
    getSettingsKeyAtom,
    getUserName,
    globalStore,
    refocusNode,
    useBlockAtom,
    WOS,
} from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { ErrorBoundary } from "@/element/errorboundary";
import { IconButton } from "@/element/iconbutton";
import { MagnifyIcon } from "@/element/magnify";
import { MenuButton } from "@/element/menubutton";
import { NodeModel } from "@/layout/index";
import * as keyutil from "@/util/keyutil";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";
import { BlockFrameProps } from "./blocktypes";

const NumActiveConnColors = 8;

function handleHeaderContextMenu(
    e: React.MouseEvent<HTMLDivElement>,
    blockData: Block,
    viewModel: ViewModel,
    magnified: boolean,
    onMagnifyToggle: () => void,
    onClose: () => void
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
            click: onClose,
        }
    );
    ContextMenuModel.showContextMenu(menu, e);
}

function getViewIconElem(viewIconUnion: string | IconButtonDecl, blockData: Block): JSX.Element {
    if (viewIconUnion == null || typeof viewIconUnion === "string") {
        const viewIcon = viewIconUnion as string;
        return <div className="block-frame-view-icon">{getBlockHeaderIcon(viewIcon, blockData)}</div>;
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
): JSX.Element[] {
    const endIconsElem: JSX.Element[] = [];
    const endIconButtons = util.useAtomValueSafe(viewModel?.endIconButtons);
    const magnified = jotai.useAtomValue(nodeModel.isMagnified);
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
    endIconsElem.push(
        <OptMagnifyButton
            key="unmagnify"
            magnified={magnified}
            toggleMagnify={nodeModel.toggleMagnify}
            disabled={magnifyDisabled}
        />
    );
    const closeDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "xmark-large",
        title: "Close",
        click: nodeModel.onClose,
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
    error,
}: BlockFrameProps & { changeConnModalAtom: jotai.PrimitiveAtom<boolean>; error?: Error }) => {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", nodeModel.blockId));
    let viewName = util.useAtomValueSafe(viewModel?.viewName) ?? blockViewToName(blockData?.meta?.view);
    const showBlockIds = jotai.useAtomValue(getSettingsKeyAtom("blockheader:showblockids"));
    let viewIconUnion = util.useAtomValueSafe(viewModel?.viewIcon) ?? blockViewToIcon(blockData?.meta?.view);
    const preIconButton = util.useAtomValueSafe(viewModel?.preIconButton);
    let headerTextUnion = util.useAtomValueSafe(viewModel?.viewText);
    const magnified = jotai.useAtomValue(nodeModel.isMagnified);
    const manageConnection = util.useAtomValueSafe(viewModel?.manageConnection);
    const dragHandleRef = preview ? null : nodeModel.dragHandleRef;

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
            handleHeaderContextMenu(e, blockData, viewModel, magnified, nodeModel.toggleMagnify, nodeModel.onClose);
        },
        [magnified]
    );

    const endIconsElem = computeEndIcons(viewModel, nodeModel, onContextMenu);
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
                    &lrm;{headerTextUnion}
                </div>
            );
        }
    } else if (Array.isArray(headerTextUnion)) {
        headerTextElems.push(...renderHeaderElements(headerTextUnion, preview));
    }
    headerTextElems.unshift(<ControllerStatusIcon key="connstatus" blockId={nodeModel.blockId} />);
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

    return (
        <div className="block-frame-default-header" ref={dragHandleRef} onContextMenu={onContextMenu}>
            {preIconButtonElem}
            <div className="block-frame-default-header-iconview">
                {viewIconElem}
                <div className="block-frame-view-type">{viewName}</div>
                {showBlockIds && <div className="block-frame-blockid">[{nodeModel.blockId.substring(0, 8)}]</div>}
            </div>
            {manageConnection && (
                <ConnectionButton
                    ref={connBtnRef}
                    key="connbutton"
                    connection={blockData?.meta?.connection}
                    changeConnModalAtom={changeConnModalAtom}
                />
            )}
            <div className="block-frame-textelems-wrapper">{headerTextElems}</div>
            <div className="block-frame-end-icons">{endIconsElem}</div>
        </div>
    );
};

const HeaderTextElem = React.memo(({ elem, preview }: { elem: HeaderElem; preview: boolean }) => {
    if (elem.elemtype == "iconbutton") {
        return <IconButton decl={elem} className={clsx("block-frame-header-iconbutton", elem.className)} />;
    } else if (elem.elemtype == "input") {
        return <Input decl={elem} className={clsx("block-frame-input", elem.className)} preview={preview} />;
    } else if (elem.elemtype == "text") {
        return (
            <div className={clsx("block-frame-text", elem.className)}>
                <span ref={preview ? null : elem.ref} onClick={(e) => elem?.onClick(e)}>
                    &lrm;{elem.text}
                </span>
            </div>
        );
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
                    <HeaderTextElem elem={child} key={childIdx} preview={preview} />
                ))}
            </div>
        );
    } else if (elem.elemtype == "menubutton") {
        return <MenuButton className="block-frame-menubutton" {...(elem as MenuButtonProps)} />;
    }
    return null;
});

function renderHeaderElements(headerTextUnion: HeaderElem[], preview: boolean): JSX.Element[] {
    const headerTextElems: JSX.Element[] = [];
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
        const blockNum = jotai.useAtomValue(nodeModel.blockNum);

        React.useEffect(() => {
            if (width) {
                const hasError = !util.isBlank(connStatus.error);
                const showError = hasError && width >= 250 && connStatus.status != "connecting";
                setShowError(showError);
            }
        }, [width, connStatus, setShowError]);

        const handleTryReconnect = React.useCallback(() => {
            const prtn = RpcApi.ConnConnectCommand(TabRpcClient, connName, { timeout: 60000 });
            prtn.catch((e) => console.log("error reconnecting", connName, e));
        }, [connName]);

        let statusText = `Disconnected from "${connName}"`;
        let showReconnect = true;
        if (connStatus.status == "connecting") {
            statusText = `Connecting to "${connName}"...`;
            showReconnect = false;
        }
        let reconDisplay = null;
        let reconClassName = "outlined grey";
        if (width && width < 350) {
            reconDisplay = <i className="fa-sharp fa-solid fa-rotate-right"></i>;
            reconClassName = clsx(reconClassName, "font-size-12 vertical-padding-5 horizontal-padding-6");
        } else {
            reconDisplay = "Reconnect";
            reconClassName = clsx(reconClassName, "font-size-11 vertical-padding-3 horizontal-padding-7");
        }
        const showIcon = connStatus.status != "connecting";

        if (isLayoutMode || connStatus.status == "connected" || connModalOpen) {
            return null;
        }

        return (
            <div className="connstatus-overlay" ref={overlayRefCallback}>
                <div className="connstatus-content">
                    <div className={clsx("connstatus-status-icon-wrapper", { "has-error": showError })}>
                        {showIcon && <i className="fa-solid fa-triangle-exclamation"></i>}
                        <div className="connstatus-status">
                            <div className="connstatus-status-text">{statusText}</div>
                            {showError ? <div className="connstatus-error">error: {connStatus.error}</div> : null}
                        </div>
                    </div>
                    {showReconnect ? (
                        <div className="connstatus-actions">
                            <Button className={reconClassName} onClick={handleTryReconnect}>
                                {reconDisplay}
                            </Button>
                        </div>
                    ) : null}
                </div>
            </div>
        );
    }
);

const BlockMask = React.memo(({ nodeModel }: { nodeModel: NodeModel }) => {
    const isFocused = jotai.useAtomValue(nodeModel.isFocused);
    const blockNum = jotai.useAtomValue(nodeModel.blockNum);
    const isLayoutMode = jotai.useAtomValue(atoms.controlShiftDelayAtom);
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", nodeModel.blockId));
    const style: React.CSSProperties = {};
    let showBlockMask = false;
    if (isFocused) {
        const tabData = jotai.useAtomValue(atoms.tabAtom);
        const tabActiveBorderColor = tabData?.meta?.["bg:activebordercolor"];
        if (tabActiveBorderColor) {
            style.borderColor = tabActiveBorderColor;
        }
        if (blockData?.meta?.["frame:activebordercolor"]) {
            style.borderColor = blockData.meta["frame:activebordercolor"];
        }
    } else {
        const tabData = jotai.useAtomValue(atoms.tabAtom);
        const tabBorderColor = tabData?.meta?.["bg:bordercolor"];
        if (tabBorderColor) {
            style.borderColor = tabBorderColor;
        }
        if (blockData?.meta?.["frame:bordercolor"]) {
            style.borderColor = blockData.meta["frame:bordercolor"];
        }
    }
    let innerElem = null;
    if (isLayoutMode) {
        showBlockMask = true;
        innerElem = (
            <div className="block-mask-inner">
                <div className="bignum">{blockNum}</div>
            </div>
        );
    }
    return (
        <div className={clsx("block-mask", { "show-block-mask": showBlockMask })} style={style}>
            {innerElem}
        </div>
    );
});

const BlockFrame_Default_Component = (props: BlockFrameProps) => {
    const { nodeModel, viewModel, blockModel, preview, numBlocksInTab, children } = props;
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", nodeModel.blockId));
    const isFocused = jotai.useAtomValue(nodeModel.isFocused);
    const viewIconUnion = util.useAtomValueSafe(viewModel?.viewIcon) ?? blockViewToIcon(blockData?.meta?.view);
    const customBg = util.useAtomValueSafe(viewModel?.blockBg);
    const manageConnection = util.useAtomValueSafe(viewModel?.manageConnection);
    const changeConnModalAtom = useBlockAtom(nodeModel.blockId, "changeConn", () => {
        return jotai.atom(false);
    }) as jotai.PrimitiveAtom<boolean>;
    const connModalOpen = jotai.useAtomValue(changeConnModalAtom);

    const connBtnRef = React.useRef<HTMLDivElement>();
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
        if (!util.isBlank(connName)) {
            console.log("ensure conn", nodeModel.blockId, connName);
            RpcApi.ConnEnsureCommand(TabRpcClient, connName, { timeout: 60000 }).catch((e) => {
                console.log("error ensuring connection", nodeModel.blockId, connName, e);
            });
        }
    }, [manageConnection, blockData]);

    const viewIconElem = getViewIconElem(viewIconUnion, blockData);
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
    const headerElem = (
        <BlockFrame_Header {...props} connBtnRef={connBtnRef} changeConnModalAtom={changeConnModalAtom} />
    );
    const headerElemNoView = React.cloneElement(headerElem, { viewModel: null });
    return (
        <div
            className={clsx("block", "block-frame-default", "block-" + nodeModel.blockId, {
                "block-focused": isFocused || preview,
                "block-preview": preview,
                "block-no-highlight": numBlocksInTab === 1,
            })}
            data-blockid={nodeModel.blockId}
            onClick={blockModel?.onClick}
            onFocusCapture={blockModel?.onFocusCapture}
            ref={blockModel?.blockRef}
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
                <ErrorBoundary fallback={headerElemNoView}>{headerElem}</ErrorBoundary>
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

const ChangeConnectionBlockModal = React.memo(
    ({
        blockId,
        viewModel,
        blockRef,
        connBtnRef,
        changeConnModalAtom,
        nodeModel,
    }: {
        blockId: string;
        viewModel: ViewModel;
        blockRef: React.RefObject<HTMLDivElement>;
        connBtnRef: React.RefObject<HTMLDivElement>;
        changeConnModalAtom: jotai.PrimitiveAtom<boolean>;
        nodeModel: NodeModel;
    }) => {
        const [connSelected, setConnSelected] = React.useState("");
        const changeConnModalOpen = jotai.useAtomValue(changeConnModalAtom);
        const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
        const isNodeFocused = jotai.useAtomValue(nodeModel.isFocused);
        const connection = blockData?.meta?.connection;
        const connStatusAtom = getConnStatusAtom(connection);
        const connStatus = jotai.useAtomValue(connStatusAtom);
        const [connList, setConnList] = React.useState<Array<string>>([]);
        const [wslList, setWslList] = React.useState<Array<string>>([]);
        const allConnStatus = jotai.useAtomValue(atoms.allConnStatus);
        const [rowIndex, setRowIndex] = React.useState(0);
        const connStatusMap = new Map<string, ConnStatus>();
        let maxActiveConnNum = 1;
        for (const conn of allConnStatus) {
            if (conn.activeconnnum > maxActiveConnNum) {
                maxActiveConnNum = conn.activeconnnum;
            }
            connStatusMap.set(conn.connection, conn);
        }
        React.useEffect(() => {
            if (!changeConnModalOpen) {
                setConnList([]);
                return;
            }
            const prtn = RpcApi.ConnListCommand(TabRpcClient, { timeout: 2000 });
            prtn.then((newConnList) => {
                setConnList(newConnList ?? []);
            }).catch((e) => console.log("unable to load conn list from backend. using blank list: ", e));
            const p2rtn = RpcApi.WslListCommand(TabRpcClient, { timeout: 2000 });
            p2rtn
                .then((newWslList) => {
                    console.log(newWslList);
                    setWslList(newWslList ?? []);
                })
                .catch((e) => {
                    // removing this log and failing silentyly since it will happen
                    // if a system isn't using the wsl. and would happen every time the
                    // typeahead was opened. good candidate for verbose log level.
                    //console.log("unable to load wsl list from backend. using blank list: ", e)
                });
        }, [changeConnModalOpen, setConnList]);

        const changeConnection = React.useCallback(
            async (connName: string) => {
                if (connName == "") {
                    connName = null;
                }
                if (connName == blockData?.meta?.connection) {
                    return;
                }
                const oldCwd = blockData?.meta?.file ?? "";
                let newCwd: string;
                if (oldCwd == "") {
                    newCwd = "";
                } else {
                    newCwd = "~";
                }
                await RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: { connection: connName, file: newCwd },
                });
                try {
                    await RpcApi.ConnEnsureCommand(TabRpcClient, connName, { timeout: 60000 });
                } catch (e) {
                    console.log("error connecting", blockId, connName, e);
                }
            },
            [blockId, blockData]
        );

        let createNew: boolean = true;
        let showReconnect: boolean = true;
        if (connSelected == "") {
            createNew = false;
        } else {
            showReconnect = false;
        }
        const filteredList: Array<string> = [];
        for (const conn of connList) {
            if (conn === connSelected) {
                createNew = false;
            }
            if (conn.includes(connSelected)) {
                filteredList.push(conn);
            }
        }
        const filteredWslList: Array<string> = [];
        for (const conn of wslList) {
            if (conn === connSelected) {
                createNew = false;
            }
            if (conn.includes(connSelected)) {
                filteredWslList.push(conn);
            }
        }
        // priority handles special suggestions when necessary
        // for instance, when reconnecting
        const newConnectionSuggestion: SuggestionConnectionItem = {
            status: "connected",
            icon: "plus",
            iconColor: "var(--conn-icon-color)",
            label: `${connSelected} (New Connection)`,
            value: "",
            onSelect: (_: string) => {
                changeConnection(connSelected);
                globalStore.set(changeConnModalAtom, false);
            },
        };
        const reconnectSuggestion: SuggestionConnectionItem = {
            status: "connected",
            icon: "arrow-right-arrow-left",
            iconColor: "var(--grey-text-color)",
            label: `Reconnect to ${connStatus.connection}`,
            value: "",
            onSelect: async (_: string) => {
                const prtn = RpcApi.ConnConnectCommand(TabRpcClient, connStatus.connection, { timeout: 60000 });
                prtn.catch((e) => console.log("error reconnecting", connStatus.connection, e));
            },
        };
        const priorityItems: Array<SuggestionConnectionItem> = [];
        if (createNew) {
            priorityItems.push(newConnectionSuggestion);
        }
        if (showReconnect && (connStatus.status == "disconnected" || connStatus.status == "error")) {
            priorityItems.push(reconnectSuggestion);
        }
        const prioritySuggestions: SuggestionConnectionScope = {
            headerText: "",
            items: priorityItems,
        };
        const localName = getUserName() + "@" + getHostName();
        const localSuggestion: SuggestionConnectionScope = {
            headerText: "Local",
            items: [],
        };
        localSuggestion.items.push({
            status: "connected",
            icon: "laptop",
            iconColor: "var(--grey-text-color)",
            value: "",
            label: localName,
            current: connection == null,
        });
        for (const wslConn of filteredWslList) {
            const connStatus = connStatusMap.get(wslConn);
            const connColorNum = computeConnColorNum(connStatus);
            localSuggestion.items.push({
                status: "connected",
                icon: "arrow-right-arrow-left",
                iconColor:
                    connStatus?.status == "connected"
                        ? `var(--conn-icon-color-${connColorNum})`
                        : "var(--grey-text-color)",
                value: "wsl://" + wslConn,
                label: "wsl://" + wslConn,
                current: "wsl://" + wslConn == connection,
            });
        }
        const remoteItems = filteredList.map((connName) => {
            const connStatus = connStatusMap.get(connName);
            const connColorNum = computeConnColorNum(connStatus);
            const item: SuggestionConnectionItem = {
                status: "connected",
                icon: "arrow-right-arrow-left",
                iconColor:
                    connStatus?.status == "connected"
                        ? `var(--conn-icon-color-${connColorNum})`
                        : "var(--grey-text-color)",
                value: connName,
                label: connName,
                current: connName == connection,
            };
            return item;
        });
        const remoteSuggestions: SuggestionConnectionScope = {
            headerText: "Remote",
            items: remoteItems,
        };

        let suggestions: Array<SuggestionsType> = [];
        if (prioritySuggestions.items.length > 0) {
            suggestions.push(prioritySuggestions);
        }
        if (localSuggestion.items.length > 0) {
            suggestions.push(localSuggestion);
        }
        if (remoteSuggestions.items.length > 0) {
            suggestions.push(remoteSuggestions);
        }

        let selectionList: Array<SuggestionConnectionItem> = [
            ...prioritySuggestions.items,
            ...localSuggestion.items,
            ...remoteSuggestions.items,
        ];

        // quick way to change icon color when highlighted
        selectionList = selectionList.map((item, index) => {
            if (index == rowIndex && item.iconColor == "var(--grey-text-color)") {
                item.iconColor = "var(--main-text-color)";
            }
            return item;
        });

        const handleTypeAheadKeyDown = React.useCallback(
            (waveEvent: WaveKeyboardEvent): boolean => {
                if (keyutil.checkKeyPressed(waveEvent, "Enter")) {
                    const rowItem = selectionList[rowIndex];
                    if ("onSelect" in rowItem && rowItem.onSelect) {
                        rowItem.onSelect(rowItem.value);
                    } else {
                        changeConnection(rowItem.value);
                        globalStore.set(changeConnModalAtom, false);
                    }
                }
                if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
                    globalStore.set(changeConnModalAtom, false);
                    setConnSelected("");
                    refocusNode(blockId);
                    return true;
                }
                if (keyutil.checkKeyPressed(waveEvent, "ArrowUp")) {
                    setRowIndex((idx) => Math.max(idx - 1, 0));
                    return true;
                }
                if (keyutil.checkKeyPressed(waveEvent, "ArrowDown")) {
                    setRowIndex((idx) => Math.min(idx + 1, selectionList.flat().length - 1));
                    return true;
                }
            },
            [changeConnModalAtom, viewModel, blockId, connSelected, selectionList]
        );
        React.useEffect(() => {
            // this is specifically for the case when the list shrinks due
            // to a search filter
            setRowIndex((idx) => Math.min(idx, selectionList.flat().length - 1));
        }, [selectionList, setRowIndex]);
        // this check was also moved to BlockFrame to prevent all the above code from running unnecessarily
        if (!changeConnModalOpen) {
            return null;
        }
        return (
            <TypeAheadModal
                blockRef={blockRef}
                anchorRef={connBtnRef}
                suggestions={suggestions}
                onSelect={(selected: string) => {
                    changeConnection(selected);
                    globalStore.set(changeConnModalAtom, false);
                }}
                selectIndex={rowIndex}
                autoFocus={isNodeFocused}
                onKeyDown={(e) => keyutil.keydownWrapper(handleTypeAheadKeyDown)(e)}
                onChange={(current: string) => setConnSelected(current)}
                value={connSelected}
                label="Connect to (username@host)..."
                onClickBackdrop={() => globalStore.set(changeConnModalAtom, false)}
            />
        );
    }
);

const BlockFrame_Default = React.memo(BlockFrame_Default_Component) as typeof BlockFrame_Default_Component;

const BlockFrame = React.memo((props: BlockFrameProps) => {
    const blockId = props.nodeModel.blockId;
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const tabData = jotai.useAtomValue(atoms.tabAtom);

    if (!blockId || !blockData) {
        return null;
    }
    const FrameElem = BlockFrame_Default;
    const numBlocks = tabData?.blockids?.length ?? 0;
    return <FrameElem {...props} numBlocksInTab={numBlocks} />;
});

export { BlockFrame, NumActiveConnColors };
