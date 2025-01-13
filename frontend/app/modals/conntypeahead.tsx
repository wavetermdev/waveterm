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
        const fullConfig = jotai.useAtomValue(atoms.fullConfigAtom);
        const connectionsConfig = fullConfig.connections;
        let filterOutNowsh = util.useAtomValueSafe(viewModel.filterOutNowsh) ?? true;

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

        let createNew: boolean = true;
        let showReconnect: boolean = true;
        if (connSelected == "") {
            createNew = false;
        } else {
            showReconnect = false;
        }
        const filteredList: Array<string> = [];
        for (const conn of connList) {
            if (
                conn.includes(connSelected) &&
                connectionsConfig?.[conn]?.["display:hidden"] != true &&
                (connectionsConfig?.[conn]?.["conn:wshenabled"] != false || !filterOutNowsh)
                // != false is necessary because of defaults
            ) {
                filteredList.push(conn);
                if (conn === connSelected) {
                    createNew = false;
                }
            }
        }
        const filteredWslList: Array<string> = [];
        for (const conn of wslList) {
            if (
                conn.includes(connSelected) &&
                connectionsConfig?.[conn]?.["display:hidden"] != true &&
                (connectionsConfig?.[conn]?.["conn:wshenabled"] != false || !filterOutNowsh)
                // != false is necessary because of defaults
            ) {
                filteredWslList.push(conn);
                if (conn === connSelected) {
                    createNew = false;
                }
            }
        }
        // priority handles special suggestions when necessary
        // for instance, when reconnecting
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
        const reconnectSuggestion: SuggestionConnectionItem = {
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
        const localName = getUserName() + "@" + getHostName();
        const localSuggestion: SuggestionConnectionScope = {
            headerText: "Local",
            items: [],
        };
        if (localName.includes(connSelected)) {
            localSuggestion.items.push({
                status: "connected",
                icon: "laptop",
                iconColor: "var(--grey-text-color)",
                value: "",
                label: localName,
                current: connection == null,
            });
        }
        if (localName == connSelected) {
            createNew = false;
        }
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
        const connectionsEditItem: SuggestionConnectionItem = {
            status: "disconnected",
            icon: "gear",
            iconColor: "var(--grey-text-color",
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
        const sortedRemoteItems = remoteItems.sort(
            (itemA: SuggestionConnectionItem, itemB: SuggestionConnectionItem) => {
                const connNameA = itemA.value;
                const connNameB = itemB.value;
                const valueA = connectionsConfig?.[connNameA]?.["display:order"] ?? 0;
                const valueB = connectionsConfig?.[connNameB]?.["display:order"] ?? 0;
                return valueA - valueB;
            }
        );
        const remoteSuggestions: SuggestionConnectionScope = {
            headerText: "Remote",
            items: [...sortedRemoteItems],
        };

        const suggestions: Array<SuggestionsType> = [
            ...(showReconnect && (connStatus.status == "disconnected" || connStatus.status == "error")
                ? [reconnectSuggestion]
                : []),
            ...(localSuggestion.items.length > 0 ? [localSuggestion] : []),
            ...(remoteSuggestions.items.length > 0 ? [remoteSuggestions] : []),
            ...(connSelected == "" ? [connectionsEditItem] : []),
            ...(createNew ? [newConnectionSuggestion] : []),
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
