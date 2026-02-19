// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    getApi,
    getBlockMetaKeyAtom,
    getBlockTermDurableAtom,
    globalStore,
    recordTEvent,
    WOS,
} from "@/store/global";
import * as services from "@/store/services";
import { base64ToString, fireAndForget, isSshConnName, isWslConnName } from "@/util/util";
import debug from "debug";
import type { TermWrap } from "./termwrap";

const dlog = debug("wave:termwrap");

const Osc52MaxDecodedSize = 75 * 1024; // max clipboard size for OSC 52 (matches common terminal implementations)
const Osc52MaxRawLength = 128 * 1024; // includes selector + base64 + whitespace (rough check)

// OSC 16162 - Shell Integration Commands
// See aiprompts/wave-osc-16162.md for full documentation
export type ShellIntegrationStatus = "ready" | "running-command";

type Osc16162Command =
    | { command: "A"; data: {} }
    | { command: "C"; data: { cmd64?: string } }
    | { command: "M"; data: { shell?: string; shellversion?: string; uname?: string; integration?: boolean; omz?: boolean; comp?: string } }
    | { command: "D"; data: { exitcode?: number } }
    | { command: "I"; data: { inputempty?: boolean } }
    | { command: "R"; data: {} };

function checkCommandForTelemetry(decodedCmd: string) {
    if (!decodedCmd) {
        return;
    }

    if (decodedCmd.startsWith("ssh ")) {
        recordTEvent("conn:connect", { "conn:conntype": "ssh-manual" });
        return;
    }

    const editorsRegex = /^(vim|vi|nano|nvim)\b/;
    if (editorsRegex.test(decodedCmd)) {
        recordTEvent("action:term", { "action:type": "cli-edit" });
        return;
    }

    const tailFollowRegex = /(^|\|\s*)tail\s+-[fF]\b/;
    if (tailFollowRegex.test(decodedCmd)) {
        recordTEvent("action:term", { "action:type": "cli-tailf" });
        return;
    }

    const claudeRegex = /^claude\b/;
    if (claudeRegex.test(decodedCmd)) {
        recordTEvent("action:term", { "action:type": "claude" });
        return;
    }

    const opencodeRegex = /^opencode\b/;
    if (opencodeRegex.test(decodedCmd)) {
        recordTEvent("action:term", { "action:type": "opencode" });
        return;
    }
}

function handleShellIntegrationCommandStart(
    termWrap: TermWrap,
    blockId: string,
    cmd: { command: "C"; data: { cmd64?: string } },
    rtInfo: ObjRTInfo // this is passed by reference and modified inside of this function
): void {
    rtInfo["shell:state"] = "running-command";
    globalStore.set(termWrap.shellIntegrationStatusAtom, "running-command");
    const connName = globalStore.get(getBlockMetaKeyAtom(blockId, "connection")) ?? "";
    const isRemote = isSshConnName(connName);
    const isWsl = isWslConnName(connName);
    const isDurable = globalStore.get(getBlockTermDurableAtom(blockId)) ?? false;
    getApi().incrementTermCommands({ isRemote, isWsl, isDurable });
    if (cmd.data.cmd64) {
        const decodedLen = Math.ceil(cmd.data.cmd64.length * 0.75);
        if (decodedLen > 8192) {
            rtInfo["shell:lastcmd"] = `# command too large (${decodedLen} bytes)`;
            globalStore.set(termWrap.lastCommandAtom, rtInfo["shell:lastcmd"]);
        } else {
            try {
                const decodedCmd = base64ToString(cmd.data.cmd64);
                rtInfo["shell:lastcmd"] = decodedCmd;
                globalStore.set(termWrap.lastCommandAtom, decodedCmd);
                checkCommandForTelemetry(decodedCmd);
            } catch (e) {
                console.error("Error decoding cmd64:", e);
                rtInfo["shell:lastcmd"] = null;
                globalStore.set(termWrap.lastCommandAtom, null);
            }
        }
    } else {
        rtInfo["shell:lastcmd"] = null;
        globalStore.set(termWrap.lastCommandAtom, null);
    }
    rtInfo["shell:lastcmdexitcode"] = null;
}

// for xterm OSC handlers, we return true always because we "own" the OSC number.
// even if data is invalid we don't want to propagate to other handlers.
export function handleOsc52Command(data: string, blockId: string, loaded: boolean, termWrap: TermWrap): boolean {
    if (!loaded) {
        return true;
    }
    const isBlockFocused = termWrap.nodeModel ? globalStore.get(termWrap.nodeModel.isFocused) : false;
    if (!document.hasFocus() || !isBlockFocused) {
        console.log("OSC 52: rejected, window or block not focused");
        return true;
    }
    if (!data || data.length === 0) {
        console.log("OSC 52: empty data received");
        return true;
    }
    if (data.length > Osc52MaxRawLength) {
        console.log("OSC 52: raw data too large", data.length);
        return true;
    }

    const semicolonIndex = data.indexOf(";");
    if (semicolonIndex === -1) {
        console.log("OSC 52: invalid format (no semicolon)", data.substring(0, 50));
        return true;
    }

    const clipboardSelection = data.substring(0, semicolonIndex);
    const base64Data = data.substring(semicolonIndex + 1);

    // clipboard query ("?") is not supported for security (prevents clipboard theft)
    if (base64Data === "?") {
        console.log("OSC 52: clipboard query not supported");
        return true;
    }

    if (base64Data.length === 0) {
        return true;
    }

    if (clipboardSelection.length > 10) {
        console.log("OSC 52: clipboard selection too long", clipboardSelection);
        return true;
    }

    const estimatedDecodedSize = Math.ceil(base64Data.length * 0.75);
    if (estimatedDecodedSize > Osc52MaxDecodedSize) {
        console.log("OSC 52: data too large", estimatedDecodedSize, "bytes");
        return true;
    }

    try {
        // strip whitespace from base64 data (some terminals chunk with newlines per RFC 4648)
        const cleanBase64Data = base64Data.replace(/\s+/g, "");
        const decodedText = base64ToString(cleanBase64Data);

        // validate actual decoded size (base64 estimate can be off for multi-byte UTF-8)
        const actualByteSize = new TextEncoder().encode(decodedText).length;
        if (actualByteSize > Osc52MaxDecodedSize) {
            console.log("OSC 52: decoded text too large", actualByteSize, "bytes");
            return true;
        }

        fireAndForget(async () => {
            try {
                await navigator.clipboard.writeText(decodedText);
                dlog("OSC 52: copied", decodedText.length, "characters to clipboard");
            } catch (err) {
                console.error("OSC 52: clipboard write failed:", err);
            }
        });
    } catch (e) {
        console.error("OSC 52: base64 decode error:", e);
    }

    return true;
}

// for xterm handlers, we return true always because we "own" OSC 7.
// even if it is invalid we dont want to propagate to other handlers
export function handleOsc7Command(data: string, blockId: string, loaded: boolean): boolean {
    if (!loaded) {
        return true;
    }
    if (data == null || data.length == 0) {
        console.log("Invalid OSC 7 command received (empty)");
        return true;
    }
    if (data.length > 1024) {
        console.log("Invalid OSC 7, data length too long", data.length);
        return true;
    }

    let pathPart: string;
    try {
        const url = new URL(data);
        if (url.protocol !== "file:") {
            console.log("Invalid OSC 7 command received (non-file protocol)", data);
            return true;
        }
        pathPart = decodeURIComponent(url.pathname);

        // Normalize double slashes at the beginning to single slash
        if (pathPart.startsWith("//")) {
            pathPart = pathPart.substring(1);
        }

        // Handle Windows paths (e.g., /C:/... or /D:\...)
        if (/^\/[a-zA-Z]:[\\/]/.test(pathPart)) {
            // Strip leading slash and normalize to forward slashes
            pathPart = pathPart.substring(1).replace(/\\/g, "/");
        }

        // Handle UNC paths (e.g., /\\server\share)
        if (pathPart.startsWith("/\\\\")) {
            // Strip leading slash but keep backslashes for UNC
            pathPart = pathPart.substring(1);
        }
    } catch (e) {
        console.log("Invalid OSC 7 command received (parse error)", data, e);
        return true;
    }

    setTimeout(() => {
        fireAndForget(async () => {
            await services.ObjectService.UpdateObjectMeta(WOS.makeORef("block", blockId), {
                "cmd:cwd": pathPart,
            });

            const rtInfo = { "shell:hascurcwd": true };
            const rtInfoData: CommandSetRTInfoData = {
                oref: WOS.makeORef("block", blockId),
                data: rtInfo,
            };
            await RpcApi.SetRTInfoCommand(TabRpcClient, rtInfoData).catch((e) =>
                console.log("error setting RT info", e)
            );
        });
    }, 0);
    return true;
}

export function handleOsc16162Command(data: string, blockId: string, loaded: boolean, termWrap: TermWrap): boolean {
    const terminal = termWrap.terminal;
    if (!loaded) {
        return true;
    }
    if (!data || data.length === 0) {
        return true;
    }

    const parts = data.split(";");
    const commandStr = parts[0];
    const jsonDataStr = parts.length > 1 ? parts.slice(1).join(";") : null;
    let parsedData: Record<string, any> = {};
    if (jsonDataStr) {
        try {
            parsedData = JSON.parse(jsonDataStr);
        } catch (e) {
            console.error("Error parsing OSC 16162 JSON data:", e);
        }
    }

    const cmd: Osc16162Command = { command: commandStr, data: parsedData } as Osc16162Command;
    const rtInfo: ObjRTInfo = {};
    switch (cmd.command) {
        case "A":
            rtInfo["shell:state"] = "ready";
            globalStore.set(termWrap.shellIntegrationStatusAtom, "ready");
            const marker = terminal.registerMarker(0);
            if (marker) {
                termWrap.promptMarkers.push(marker);
                // addTestMarkerDecoration(terminal, marker, termWrap);
                marker.onDispose(() => {
                    const idx = termWrap.promptMarkers.indexOf(marker);
                    if (idx !== -1) {
                        termWrap.promptMarkers.splice(idx, 1);
                    }
                });
            }
            break;
        case "C":
            handleShellIntegrationCommandStart(termWrap, blockId, cmd, rtInfo);
            break;
        case "M":
            if (cmd.data.shell) {
                rtInfo["shell:type"] = cmd.data.shell;
            }
            if (cmd.data.shellversion) {
                rtInfo["shell:version"] = cmd.data.shellversion;
            }
            if (cmd.data.uname) {
                rtInfo["shell:uname"] = cmd.data.uname;
            }
            if (cmd.data.integration != null) {
                rtInfo["shell:integration"] = cmd.data.integration;
            }
            if (cmd.data.omz != null) {
                rtInfo["shell:omz"] = cmd.data.omz;
            }
            if (cmd.data.comp != null) {
                rtInfo["shell:comp"] = cmd.data.comp;
            }
            break;
        case "D":
            if (cmd.data.exitcode != null) {
                rtInfo["shell:lastcmdexitcode"] = cmd.data.exitcode;
            } else {
                rtInfo["shell:lastcmdexitcode"] = null;
            }
            break;
        case "I":
            if (cmd.data.inputempty != null) {
                rtInfo["shell:inputempty"] = cmd.data.inputempty;
            }
            break;
        case "R":
            globalStore.set(termWrap.shellIntegrationStatusAtom, null);
            if (terminal.buffer.active.type === "alternate") {
                terminal.write("\x1b[?1049l");
            }
            break;
    }

    if (Object.keys(rtInfo).length > 0) {
        setTimeout(() => {
            fireAndForget(async () => {
                const rtInfoData: CommandSetRTInfoData = {
                    oref: WOS.makeORef("block", blockId),
                    data: rtInfo,
                };
                await RpcApi.SetRTInfoCommand(TabRpcClient, rtInfoData).catch((e) =>
                    console.log("error setting RT info (OSC 16162)", e)
                );
            });
        }, 0);
    }

    return true;
}
