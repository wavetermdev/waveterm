// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useLongClick } from "@/app/hook/useLongClick";
import { getConnStatusAtom, waveEventSubscribe, WOS } from "@/app/store/global";
import * as services from "@/app/store/services";
import { makeORef } from "@/app/store/wos";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";
import DotsSvg from "../asset/dots-anim-4.svg";

export const colorRegex = /^((#[0-9a-f]{6,8})|([a-z]+))$/;

export function blockViewToIcon(view: string): string {
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
    if (view == "help") {
        return "circle-question";
    }
    return "square";
}

export function blockViewToName(view: string): string {
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
    if (view == "help") {
        return "Help";
    }
    return view;
}

export function processTitleString(titleString: string): React.ReactNode[] {
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

export function getBlockHeaderIcon(blockIcon: string, blockData: Block): React.ReactNode {
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

export const IconButton = React.memo(({ decl, className }: { decl: HeaderIconButton; className?: string }) => {
    const buttonRef = React.useRef<HTMLDivElement>(null);
    useLongClick(buttonRef, decl.click, decl.longClick, decl.disabled);
    return (
        <div
            ref={buttonRef}
            className={clsx("iconbutton", className, decl.className, { disabled: decl.disabled })}
            title={decl.title}
        >
            {typeof decl.icon === "string" ? <i className={util.makeIconClass(decl.icon, true)} /> : decl.icon}
        </div>
    );
});

interface ConnectionButtonProps {
    connection: string;
    changeConnModalAtom: jotai.PrimitiveAtom<boolean>;
}

export const ControllerStatusIcon = React.memo(({ blockId }: { blockId: string }) => {
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const hasController = !util.isBlank(blockData?.meta?.controller);
    const [controllerStatus, setControllerStatus] = React.useState<BlockControllerRuntimeStatus>(null);
    const [gotInitialStatus, setGotInitialStatus] = React.useState(false);
    const connection = blockData?.meta?.connection ?? "local";
    const connStatusAtom = getConnStatusAtom(connection);
    const connStatus = jotai.useAtomValue(connStatusAtom);
    React.useEffect(() => {
        if (!hasController) {
            return;
        }
        const initialRTStatus = services.BlockService.GetControllerStatus(blockId);
        initialRTStatus.then((rts) => {
            setGotInitialStatus(true);
            setControllerStatus(rts);
        });
        const unsubFn = waveEventSubscribe("controllerstatus", makeORef("block", blockId), (event) => {
            const cstatus: BlockControllerRuntimeStatus = event.data;
            setControllerStatus(cstatus);
        });
        return () => {
            unsubFn();
        };
    }, [hasController]);
    if (!hasController || !gotInitialStatus) {
        return null;
    }
    if (controllerStatus?.shellprocstatus == "running") {
        return null;
    }
    if (connStatus?.status != "connected") {
        return null;
    }
    const controllerStatusElem = (
        <div className="iconbutton disabled" key="controller-status">
            <i className="fa-sharp fa-solid fa-triangle-exclamation" title="Shell Process Is Not Running" />
        </div>
    );
    return controllerStatusElem;
});

export const ConnectionButton = React.memo(
    React.forwardRef<HTMLDivElement, ConnectionButtonProps>(
        ({ connection, changeConnModalAtom }: ConnectionButtonProps, ref) => {
            const [connModalOpen, setConnModalOpen] = jotai.useAtom(changeConnModalAtom);
            const isLocal = util.isBlank(connection);
            const connStatusAtom = getConnStatusAtom(connection);
            const connStatus = jotai.useAtomValue(connStatusAtom);
            let showDisconnectedSlash = false;
            let connIconElem: React.ReactNode = null;
            let color = "var(--conn-icon-color)";
            const clickHandler = function () {
                setConnModalOpen(true);
            };
            let titleText = null;
            let shouldSpin = false;
            if (isLocal) {
                color = "var(--grey-text-color)";
                titleText = "Connected to Local Machine";
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

            return (
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
                    {isLocal ? null : <div className="connection-name">{connection}</div>}
                </div>
            );
        }
    )
);

export const Input = React.memo(
    ({ decl, className, preview }: { decl: HeaderInput; className: string; preview: boolean }) => {
        const { value, ref, isDisabled, onChange, onKeyDown, onFocus, onBlur } = decl;
        return (
            <div className="input-wrapper">
                <input
                    ref={
                        !preview
                            ? ref
                            : undefined /* don't wire up the input field if the preview block is being rendered */
                    }
                    disabled={isDisabled}
                    className={className}
                    value={value}
                    onChange={(e) => onChange(e)}
                    onKeyDown={(e) => onKeyDown(e)}
                    onFocus={(e) => onFocus(e)}
                    onBlur={(e) => onBlur(e)}
                    onDragStart={(e) => e.preventDefault()}
                />
            </div>
        );
    }
);
