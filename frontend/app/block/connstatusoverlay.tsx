// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { CopyButton } from "@/app/element/copybutton";
import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { atoms, getConnStatusAtom, WOS } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { NodeModel } from "@/layout/index";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import * as React from "react";

export const ConnStatusOverlay = React.memo(
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
        const connName = blockData?.meta?.connection;
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
        }, [connName, nodeModel.blockId]);

        const handleDisableWsh = React.useCallback(async () => {
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
ConnStatusOverlay.displayName = "ConnStatusOverlay";
