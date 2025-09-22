// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { computeConnColorNum } from "@/app/block/blockutil";
import { TypeAheadModal } from "@/app/modals/typeaheadmodal";
import {
    atoms,
    createBlock,
    getApi,
    getConnStatusAtom,
    getHostName,
    getUserName,
    globalStore,
    WOS,
} from "@/app/store/global";
import { globalRefocusWithTimeout } from "@/app/store/keymodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { NodeModel } from "@/layout/index";
import * as keyutil from "@/util/keyutil";
import * as util from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";

// newConnList -> connList => filteredList -> remoteItems -> sortedRemoteItems => remoteSuggestion
// filteredList -> createNew

function filterConnections(
    connList: Array<string>,
    connSelected: string,
    fullConfig: FullConfigType,
    filterOutNowsh: boolean
): Array<string> {
    const connectionsConfig = fullConfig.connections;
    return connList.filter((conn) => {
        const hidden = connectionsConfig?.[conn]?.["display:hidden"] ?? false;
        const wshEnabled = connectionsConfig?.[conn]?.["conn:wshenabled"] ?? true;
        return conn.includes(connSelected) && !hidden && (wshEnabled || !filterOutNowsh);
    });
}

function sortConnSuggestionItems(
    connSuggestions: Array<SuggestionConnectionItem>,
    fullConfig: FullConfigType
): Array<SuggestionConnectionItem> {
    const connectionsConfig = fullConfig.connections;
    return connSuggestions.sort((itemA: SuggestionConnectionItem, itemB: SuggestionConnectionItem) => {
        const connNameA = itemA.value;
        const connNameB = itemB.value;
        const valueA = connectionsConfig?.[connNameA]?.["display:order"] ?? 0;
        const valueB = connectionsConfig?.[connNameB]?.["display:order"] ?? 0;
        return valueA - valueB;
    });
}

function createRemoteSuggestionItems(
    filteredList: Array<string>,
    connection: string,
    connStatusMap: Map<string, ConnStatus>
): Array<SuggestionConnectionItem> {
    return filteredList.map((connName) => {
        const connStatus = connStatusMap.get(connName);
        const connColorNum = computeConnColorNum(connStatus);
        const item: SuggestionConnectionItem = {
            status: "connected",
            icon: "arrow-right-arrow-left",
            iconColor:
                connStatus?.status == "connected" ? `var(--conn-icon-color-${connColorNum})` : "var(--grey-text-color)",
            value: connName,
            label: connName,
            current: connName == connection,
        };
        return item;
    });
}

function createWslSuggestionItems(
    filteredList: Array<string>,
    connection: string,
    connStatusMap: Map<string, ConnStatus>
): Array<SuggestionConnectionItem> {
    return filteredList.map((connName) => {
        const connStatus = connStatusMap.get(`wsl://${connName}`);
        const connColorNum = computeConnColorNum(connStatus);
        const item: SuggestionConnectionItem = {
            status: "connected",
            icon: "arrow-right-arrow-left",
            iconColor:
                connStatus?.status == "connected" ? `var(--conn-icon-color-${connColorNum})` : "var(--grey-text-color)",
            value: "wsl://" + connName,
            label: "wsl://" + connName,
            current: "wsl://" + connName == connection,
        };
        return item;
    });
}

function createFilteredLocalSuggestionItem(
    localName: string,
    connection: string,
    connSelected: string
): Array<SuggestionConnectionItem> {
    if (localName.includes(connSelected)) {
        const localSuggestion: SuggestionConnectionItem = {
            status: "connected",
            icon: "laptop",
            iconColor: "var(--grey-text-color)",
            value: "",
            label: localName,
            current: connection == null,
        };
        return [localSuggestion];
    }
    return [];
}

function createS3SuggestionItems(
    s3Profiles: Array<string>,
    connStatusMap: Map<string, ConnStatus>,
    connection: string
): Array<SuggestionConnectionItem> {
    // TODO-S3 rewrite this so it fits the way the
    // s3 connections work. is there a connection status?
    // probably not, so color may be weird
    // also, this currently only changes the connection
    // an onSelect option must be added for different
    // behavior
    return s3Profiles.map((profileName) => {
        const connStatus = connStatusMap.get(profileName);
        const item: SuggestionConnectionItem = {
            status: "connected",
            icon: "database",
            iconColor: "var(--accent-color)",
            value: profileName,
            label: profileName,
            current: profileName == connection,
        };
        return item;
    });
}

function getReconnectItem(
    connStatus: ConnStatus,
    connSelected: string,
    blockId: string
): SuggestionConnectionItem | null {
    if (connSelected != "" || (connStatus.status != "disconnected" && connStatus.status != "error")) {
        return null;
    }
    const reconnectSuggestionItem: SuggestionConnectionItem = {
        status: "connected",
        icon: "arrow-right-arrow-left",
        iconColor: "var(--grey-text-color)",
        label: `Reconnect to ${connStatus.connection}`,
        value: "",
        onSelect: async (_: string) => {
            const prtn = RpcApi.ConnConnectCommand(
                TabRpcClient,
                { host: connStatus.connection, logblockid: blockId },
                { timeout: 60000 }
            );
            prtn.catch((e) => console.log("error reconnecting", connStatus.connection, e));
        },
    };
    return reconnectSuggestionItem;
}

function getLocalSuggestions(
    localName: string,
    connList: Array<string>,
    connection: string,
    connSelected: string,
    connStatusMap: Map<string, ConnStatus>,
    fullConfig: FullConfigType,
    filterOutNowsh: boolean
): SuggestionConnectionScope | null {
    const wslFiltered = filterConnections(connList, connSelected, fullConfig, filterOutNowsh);
    const wslSuggestionItems = createWslSuggestionItems(wslFiltered, connection, connStatusMap);
    const localSuggestionItem = createFilteredLocalSuggestionItem(localName, connection, connSelected);
    const combinedSuggestionItems = [...localSuggestionItem, ...wslSuggestionItems];
    const sortedSuggestionItems = sortConnSuggestionItems(combinedSuggestionItems, fullConfig);
    if (sortedSuggestionItems.length == 0) {
        return null;
    }
    const localSuggestions: SuggestionConnectionScope = {
        headerText: "Local",
        items: sortedSuggestionItems,
    };
    return localSuggestions;
}

function getRemoteSuggestions(
    connList: Array<string>,
    connection: string,
    connSelected: string,
    connStatusMap: Map<string, ConnStatus>,
    fullConfig: FullConfigType,
    filterOutNowsh: boolean
): SuggestionConnectionScope | null {
    const filtered = filterConnections(connList, connSelected, fullConfig, filterOutNowsh);
    const suggestionItems = createRemoteSuggestionItems(filtered, connection, connStatusMap);
    const sortedSuggestionItems = sortConnSuggestionItems(suggestionItems, fullConfig);
    if (sortedSuggestionItems.length == 0) {
        return null;
    }
    const remoteSuggestions: SuggestionConnectionScope = {
        headerText: "Remote",
        items: sortedSuggestionItems,
    };
    return remoteSuggestions;
}

function getS3Suggestions(
    s3Profiles: Array<string>,
    connection: string,
    connSelected: string,
    connStatusMap: Map<string, ConnStatus>,
    fullConfig: FullConfigType,
    filterOutNowsh: boolean
): SuggestionConnectionScope | null {
    const filtered = filterConnections(s3Profiles, connSelected, fullConfig, filterOutNowsh);
    const s3Items = createS3SuggestionItems(filtered, connStatusMap, connection);
    const sortedS3Items = sortConnSuggestionItems(s3Items, fullConfig);
    if (sortedS3Items.length == 0) {
        return null;
    }
    const s3Suggestions: SuggestionConnectionScope = {
        headerText: "S3",
        items: sortedS3Items,
    };
    return s3Suggestions;
}

function getDisconnectItem(
    connection: string,
    connStatusMap: Map<string, ConnStatus>
): SuggestionConnectionItem | null {
    if (!connection) {
        return null;
    }
    const connStatus = connStatusMap.get(connection);
    if (!connStatus || connStatus.status != "connected") {
        return null;
    }
    const disconnectSuggestionItem: SuggestionConnectionItem = {
        status: "connected",
        icon: "xmark",
        iconColor: "var(--grey-text-color)",
        label: `Disconnect ${connStatus.connection}`,
        value: "",
        onSelect: async (_: string) => {
            const prtn = RpcApi.ConnDisconnectCommand(TabRpcClient, connection, { timeout: 60000 });
            prtn.catch((e) => console.log("error disconnecting", connStatus.connection, e));
        },
    };
    return disconnectSuggestionItem;
}

function getConnectionsEditItem(
    changeConnModalAtom: jotai.PrimitiveAtom<boolean>,
    connSelected: string
): SuggestionConnectionItem | null {
    if (connSelected != "") {
        return null;
    }
    const connectionsEditItem: SuggestionConnectionItem = {
        status: "disconnected",
        icon: "gear",
        iconColor: "var(--grey-text-color)",
        value: "Edit Connections",
        label: "Edit Connections",
        onSelect: () => {
            util.fireAndForget(async () => {
                globalStore.set(changeConnModalAtom, false);
                const path = `${getApi().getConfigDir()}/connections.json`;
                const blockDef: BlockDef = {
                    meta: {
                        view: "preview",
                        file: path,
                    },
                };
                await createBlock(blockDef, false, true);
            });
        },
    };
    return connectionsEditItem;
}

function getNewConnectionSuggestionItem(
    connSelected: string,
    localName: string,
    remoteConns: Array<string>,
    wslConns: Array<string>,
    s3Conns: Array<string>,
    changeConnection: (connName: string) => Promise<void>,
    changeConnModalAtom: jotai.PrimitiveAtom<boolean>
): SuggestionConnectionItem | null {
    const allCons = ["", localName, ...remoteConns, ...wslConns, ...s3Conns];
    if (allCons.includes(connSelected)) {
        // do not offer to create a new connection if one
        // with the exact name already exists
        return null;
    }
    const newConnectionSuggestion: SuggestionConnectionItem = {
        status: "connected",
        icon: "plus",
        iconColor: "var(--grey-text-color)",
        label: `${connSelected} (New Connection)`,
        value: "",
        onSelect: (_: string) => {
            changeConnection(connSelected);
            globalStore.set(changeConnModalAtom, false);
        },
    };
    return newConnectionSuggestion;
}

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
        const [s3List, setS3List] = React.useState<Array<string>>([]);
        const allConnStatus = jotai.useAtomValue(atoms.allConnStatus);
        const [rowIndex, setRowIndex] = React.useState(0);
        const connStatusMap = new Map<string, ConnStatus>();
        const fullConfig = jotai.useAtomValue(atoms.fullConfigAtom);
        let filterOutNowsh = util.useAtomValueSafe(viewModel.filterOutNowsh) ?? true;
        const showS3 = util.useAtomValueSafe(viewModel.showS3) ?? false;

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
            RpcApi.ConnListAWSCommand(TabRpcClient, { timeout: 2000 })
                .then((s3List) => setS3List(s3List ?? []))
                .catch((e) => console.log("unable to load s3 list from backend:", e));
        }, [changeConnModalOpen]);

        const changeConnection = React.useCallback(
            async (connName: string) => {
                if (connName == "") {
                    connName = null;
                }
                if (connName == blockData?.meta?.connection) {
                    return;
                }
                const isAws = connName?.startsWith("aws:");
                const oldFile = blockData?.meta?.file ?? "";
                let newFile: string;
                if (oldFile == "") {
                    newFile = "";
                } else if (isAws) {
                    newFile = "/";
                } else {
                    newFile = "~";
                }
                await RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: { connection: connName, file: newFile, "cmd:cwd": null, "cmd:hascurcwd": null },
                });
                try {
                    await RpcApi.ConnEnsureCommand(
                        TabRpcClient,
                        { connname: connName, logblockid: blockId },
                        { timeout: 60000 }
                    );
                } catch (e) {
                    console.log("error connecting", blockId, connName, e);
                }
            },
            [blockId, blockData]
        );

        const reconnectSuggestionItem = getReconnectItem(connStatus, connSelected, blockId);
        const localName = getUserName() + "@" + getHostName();
        const localSuggestions = getLocalSuggestions(
            localName,
            wslList,
            connection,
            connSelected,
            connStatusMap,
            fullConfig,
            filterOutNowsh
        );
        const remoteSuggestions = getRemoteSuggestions(
            connList,
            connection,
            connSelected,
            connStatusMap,
            fullConfig,
            filterOutNowsh
        );
        let s3Suggestions: SuggestionConnectionScope = null;
        if (showS3) {
            s3Suggestions = getS3Suggestions(
                s3List,
                connection,
                connSelected,
                connStatusMap,
                fullConfig,
                filterOutNowsh
            );
        }
        const connectionsEditItem = getConnectionsEditItem(changeConnModalAtom, connSelected);
        const disconnectItem = getDisconnectItem(connection, connStatusMap);
        const newConnectionSuggestionItem = getNewConnectionSuggestionItem(
            connSelected,
            localName,
            connList,
            wslList,
            s3List,
            changeConnection,
            changeConnModalAtom
        );

        const suggestions: Array<SuggestionsType> = [
            ...(reconnectSuggestionItem ? [reconnectSuggestionItem] : []),
            ...(localSuggestions ? [localSuggestions] : []),
            ...(remoteSuggestions ? [remoteSuggestions] : []),
            ...(s3Suggestions ? [s3Suggestions] : []),
            ...(disconnectItem ? [disconnectItem] : []),
            ...(connectionsEditItem ? [connectionsEditItem] : []),
            ...(newConnectionSuggestionItem ? [newConnectionSuggestionItem] : []),
        ];

        let selectionList: Array<SuggestionConnectionItem> = suggestions.flatMap((item) => {
            if ("items" in item) {
                return item.items;
            }
            return item;
        });

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
                        globalRefocusWithTimeout(10);
                    }
                    setRowIndex(0);
                    return true;
                }
                if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
                    globalStore.set(changeConnModalAtom, false);
                    setConnSelected("");
                    globalRefocusWithTimeout(10);
                    return true;
                }
                if (keyutil.checkKeyPressed(waveEvent, "ArrowUp")) {
                    setRowIndex((idx) => Math.max(idx - 1, 0));
                    return true;
                }
                if (keyutil.checkKeyPressed(waveEvent, "ArrowDown")) {
                    setRowIndex((idx) => Math.min(idx + 1, selectionList.length - 1));
                    return true;
                }
                setRowIndex(0);
                return false;
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
                    globalRefocusWithTimeout(10);
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

export { ChangeConnectionBlockModal };
