// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function posixEscapePath(path: string): string {
    if (path === "~") return "~";
    if (path.startsWith("~/")) {
        return "~/" + "'" + path.slice(2).replace(/'/g, "'\\''") + "'";
    }
    return "'" + path.replace(/'/g, "'\\''") + "'";
}

export function pwshEscapePath(path: string): string {
    return "'" + path.replace(/'/g, "''") + "'";
}

export function cmdEscapePath(path: string): string {
    return '"' + path.replace(/%/g, "%%").replace(/"/g, '""') + '"';
}

export function buildCdCommand(shellType: string, path: string): string {
    const normalizedShellType = (shellType || "").toLowerCase();
    if (normalizedShellType === "pwsh" || normalizedShellType === "powershell") {
        return "\x1bSet-Location -LiteralPath " + pwshEscapePath(path) + "\r";
    }
    if (normalizedShellType === "cmd") {
        return "\x1bcd /d " + cmdEscapePath(path) + "\r";
    }
    return "\x15cd " + posixEscapePath(path) + "\r";
}
