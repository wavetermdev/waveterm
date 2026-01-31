// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { computeConnColorNum } from "@/app/block/blockutil";
import { getConnStatusAtom, recordTEvent } from "@/app/store/global";
import { IconButton } from "@/element/iconbutton";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";
import DotsSvg from "../asset/dots-anim-4.svg";

interface ConnectionButtonProps {
    connection: string;
    changeConnModalAtom: jotai.PrimitiveAtom<boolean>;
    isTerminalBlock?: boolean;
}

export const ConnectionButton = React.memo(
    React.forwardRef<HTMLDivElement, ConnectionButtonProps>(
        ({ connection, changeConnModalAtom, isTerminalBlock }: ConnectionButtonProps, ref) => {
            const [connModalOpen, setConnModalOpen] = jotai.useAtom(changeConnModalAtom);
            const isLocal = util.isLocalConnName(connection);
            const connStatusAtom = getConnStatusAtom(connection);
            const connStatus = jotai.useAtomValue(connStatusAtom);
            let showDisconnectedSlash = false;
            let connIconElem: React.ReactNode = null;
            const connColorNum = computeConnColorNum(connStatus);
            let color = `var(--conn-icon-color-${connColorNum})`;
            const clickHandler = function () {
                recordTEvent("action:other", { "action:type": "conndropdown", "action:initiator": "mouse" });
                setConnModalOpen(true);
            };
            let titleText = null;
            let shouldSpin = false;
            let connDisplayName: string = null;
            if (isLocal) {
                color = "var(--grey-text-color)";
                if (connection === "local:gitbash") {
                    titleText = "Connected to Git Bash";
                    connDisplayName = "Git Bash";
                } else {
                    titleText = "Connected to Local Machine";
                }
                connIconElem = (
                    <i
                        className={clsx(util.makeIconClass("laptop", false), "fa-stack-1x")}
                        style={{ color: color, marginRight: 2 }}
                    />
                );
            } else {
                titleText = "Connected to " + connection;
                let iconName = "arrow-right-arrow-left";
                let iconSvg = null;
                if (connStatus?.status == "connecting") {
                    color = "var(--warning-color)";
                    titleText = "Connecting to " + connection;
                    shouldSpin = false;
                    iconSvg = (
                        <div className="connecting-svg">
                            <DotsSvg />
                        </div>
                    );
                } else if (connStatus?.status == "error") {
                    color = "var(--error-color)";
                    titleText = "Error connecting to " + connection;
                    if (connStatus?.error != null) {
                        titleText += " (" + connStatus.error + ")";
                    }
                    showDisconnectedSlash = true;
                } else if (!connStatus?.connected) {
                    color = "var(--grey-text-color)";
                    titleText = "Disconnected from " + connection;
                    showDisconnectedSlash = true;
                }
                if (iconSvg != null) {
                    connIconElem = iconSvg;
                } else {
                    connIconElem = (
                        <i
                            className={clsx(util.makeIconClass(iconName, false), "fa-stack-1x")}
                            style={{ color: color, marginRight: 2 }}
                        />
                    );
                }
            }

            const wshProblem = connection && !connStatus?.wshenabled && connStatus?.status == "connected";
            const showNoWshButton = wshProblem && !isLocal;

            return (
                <>
                    <div ref={ref} className={clsx("connection-button")} onClick={clickHandler} title={titleText}>
                        <span className={clsx("fa-stack connection-icon-box", shouldSpin ? "fa-spin" : null)}>
                            {connIconElem}
                            <i
                                className="fa-slash fa-solid fa-stack-1x"
                                style={{
                                    color: color,
                                    marginRight: "2px",
                                    textShadow: "0 1px black, 0 1.5px black",
                                    opacity: showDisconnectedSlash ? 1 : 0,
                                }}
                            />
                        </span>
                        {connDisplayName ? (
                            <div className="connection-name ellipsis">{connDisplayName}</div>
                        ) : isLocal ? null : (
                            <div className="connection-name ellipsis">{connection}</div>
                        )}
                    </div>
                    {showNoWshButton && (
                        <IconButton
                            decl={{
                                elemtype: "iconbutton",
                                icon: "link-slash",
                                title: "wsh is not installed for this connection",
                            }}
                            className="block-frame-header-iconbutton"
                        />
                    )}
                </>
            );
        }
    )
);
ConnectionButton.displayName = "ConnectionButton";
