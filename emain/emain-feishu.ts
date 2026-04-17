// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import fs from "node:fs";
import * as child_process from "node:child_process";
import path from "node:path";
import { RpcApi } from "../frontend/app/store/wshclientapi";
import { callWithOriginalXdgCurrentDesktopAsync, unamePlatform } from "./emain-platform";
import { ElectronWshClient } from "./emain-wsh";

export const FeishuFallbackUrl = "https://www.feishu.cn/messenger/";

const FeishuProtocols = ["feishu://", "lark://"];

const WindowsRegistryKeys = [
    "HKCU\\Software\\Classes\\feishu\\shell\\open\\command",
    "HKCR\\feishu\\shell\\open\\command",
    "HKCU\\Software\\Classes\\lark\\shell\\open\\command",
    "HKCR\\lark\\shell\\open\\command",
];

export type OpenFeishuResult = {
    opened: boolean;
    method: string;
    fallbackUrl: string;
    appPath?: string;
    error?: string;
};

function normalizeAppPath(appPath?: string | null): string | null {
    if (appPath == null) {
        return null;
    }
    const trimmedPath = appPath.trim();
    if (trimmedPath === "") {
        return null;
    }
    return trimmedPath;
}

function isLaunchablePath(appPath?: string | null): appPath is string {
    if (appPath == null) {
        return false;
    }
    try {
        return fs.existsSync(appPath) && fs.statSync(appPath).isFile();
    } catch {
        return false;
    }
}

function launchExecutable(appPath: string): boolean {
    if (!isLaunchablePath(appPath)) {
        return false;
    }
    try {
        const child = child_process.spawn(appPath, [], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
        });
        child.unref();
        return true;
    } catch {
        return false;
    }
}

async function openProtocol(protocolUrl: string): Promise<void> {
    await callWithOriginalXdgCurrentDesktopAsync(() => electron.shell.openExternal(protocolUrl));
}

async function tryOpenByProtocol(): Promise<OpenFeishuResult | null> {
    let lastError: string | null = null;
    for (const protocolUrl of FeishuProtocols) {
        try {
            await openProtocol(protocolUrl);
            return {
                opened: true,
                method: `protocol:${protocolUrl}`,
                fallbackUrl: FeishuFallbackUrl,
            };
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
    }
    if (lastError != null) {
        return {
            opened: false,
            method: "protocol",
            fallbackUrl: FeishuFallbackUrl,
            error: lastError,
        };
    }
    return null;
}

async function getConfiguredFeishuAppPath(): Promise<string | null> {
    const envPath = normalizeAppPath(process.env.WAVETERM_FEISHU_APP_PATH);
    if (envPath != null) {
        return envPath;
    }
    try {
        const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
        const configuredPath = normalizeAppPath(fullConfig?.settings?.["feishu:apppath"]);
        if (configuredPath != null) {
            return configuredPath;
        }
    } catch {
        // ignore config lookup failures and continue with auto-discovery
    }
    return null;
}

async function queryWindowsRegistry(key: string): Promise<string | null> {
    return await new Promise((resolve) => {
        child_process.execFile("reg.exe", ["query", key, "/ve"], { windowsHide: true }, (error, stdout) => {
            if (error != null || stdout == null || stdout.trim() === "") {
                resolve(null);
                return;
            }
            resolve(stdout);
        });
    });
}

function extractExecutablePath(commandValue: string): string | null {
    const quotedMatch = commandValue.match(/"([^"]+?\.exe)"/i);
    if (quotedMatch?.[1]) {
        return quotedMatch[1];
    }
    const unquotedMatch = commandValue.match(/([A-Za-z]:\\[^\r\n]+?\.exe)\b/i);
    if (unquotedMatch?.[1]) {
        return unquotedMatch[1];
    }
    return null;
}

async function findWindowsRegistryAppPath(): Promise<string | null> {
    for (const key of WindowsRegistryKeys) {
        const commandValue = await queryWindowsRegistry(key);
        const executablePath = extractExecutablePath(commandValue ?? "");
        if (isLaunchablePath(executablePath)) {
            return executablePath;
        }
    }
    return null;
}

function getCommonWindowsPaths(): string[] {
    const candidatePaths = [
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Feishu", "app", "Feishu.exe") : null,
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Lark", "app", "Lark.exe") : null,
        path.join("C:\\Program Files", "Feishu", "Feishu.exe"),
        path.join("C:\\Program Files", "Lark", "Lark.exe"),
        path.join("C:\\Program Files (x86)", "Feishu", "Feishu.exe"),
        path.join("C:\\Program Files (x86)", "Lark", "Lark.exe"),
    ];
    return [...new Set(candidatePaths.filter((candidatePath) => candidatePath != null))];
}

async function tryOpenByExecutablePath(appPath: string, method: string): Promise<OpenFeishuResult | null> {
    if (!launchExecutable(appPath)) {
        return null;
    }
    return {
        opened: true,
        method,
        fallbackUrl: FeishuFallbackUrl,
        appPath,
    };
}

export async function openFeishuApp(): Promise<OpenFeishuResult> {
    const protocolResult = await tryOpenByProtocol();
    if (protocolResult?.opened) {
        return protocolResult;
    }

    const configuredPath = await getConfiguredFeishuAppPath();
    const configuredPathResult = await tryOpenByExecutablePath(configuredPath, "configured-path");
    if (configuredPathResult != null) {
        return configuredPathResult;
    }

    if (unamePlatform === "win32") {
        const registryAppPath = await findWindowsRegistryAppPath();
        const registryResult = await tryOpenByExecutablePath(registryAppPath, "windows-registry");
        if (registryResult != null) {
            return registryResult;
        }

        for (const commonPath of getCommonWindowsPaths()) {
            const commonPathResult = await tryOpenByExecutablePath(commonPath, "common-path");
            if (commonPathResult != null) {
                return commonPathResult;
            }
        }
    }

    return {
        opened: false,
        method: "web-fallback",
        fallbackUrl: FeishuFallbackUrl,
        error: protocolResult?.error ?? "Unable to locate a local Feishu installation",
    };
}
