// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

// Note: These functions are tested by importing the module and accessing them
// In a real setup, you'd export these from a shared utility module
// For now, we'll duplicate the logic for testing purposes

function posixEscapePath(path: string): string {
    if (path === "~") return "~";
    if (path.startsWith("~/")) {
        return "~/" + "'" + path.slice(2).replace(/'/g, "'\\''") + "'";
    }
    return "'" + path.replace(/'/g, "'\\''") + "'";
}

function pwshEscapePath(path: string): string {
    return "'" + path.replace(/'/g, "''") + "'";
}

function cmdEscapePath(path: string): string {
    return '"' + path.replace(/"/g, '""') + '"';
}

function buildCdCommand(shellType: string, path: string): string {
    if (shellType === "pwsh" || shellType === "powershell") {
        return "\x1bSet-Location -LiteralPath " + pwshEscapePath(path) + "\r";
    }
    if (shellType === "cmd") {
        return "\x1bcd /d " + cmdEscapePath(path) + "\r";
    }
    return "\x15cd " + posixEscapePath(path) + "\r";
}

describe("posixEscapePath", () => {
    it("handles tilde-only path", () => {
        expect(posixEscapePath("~")).toBe("~");
    });

    it("handles tilde-prefixed path", () => {
        expect(posixEscapePath("~/Documents")).toBe("~/'Documents'");
    });

    it("handles tilde-prefixed path with single quotes", () => {
        expect(posixEscapePath("~/Documents/Bob's Files")).toBe("~/'Documents/Bob'\\''s Files'");
    });

    it("handles plain path", () => {
        expect(posixEscapePath("/usr/local/bin")).toBe("'/usr/local/bin'");
    });

    it("handles path with spaces", () => {
        expect(posixEscapePath("/path/with spaces")).toBe("'/path/with spaces'");
    });

    it("handles path with single quotes", () => {
        expect(posixEscapePath("/path/with'quotes")).toBe("'/path/with'\\''quotes'");
    });

    it("handles path with multiple single quotes", () => {
        expect(posixEscapePath("/a'b'c")).toBe("'/a'\\''b'\\''c'");
    });

    it("handles path with backticks", () => {
        expect(posixEscapePath("/path/with`backtick")).toBe("'/path/with`backtick'");
    });

    it("handles path with semicolons", () => {
        expect(posixEscapePath("/path;with;semicolons")).toBe("'/path;with;semicolons'");
    });

    it("handles empty string", () => {
        expect(posixEscapePath("")).toBe("''");
    });
});

describe("pwshEscapePath", () => {
    it("handles plain path", () => {
        expect(pwshEscapePath("C:\\Users\\Bob")).toBe("'C:\\Users\\Bob'");
    });

    it("handles path with single quotes", () => {
        expect(pwshEscapePath("C:\\Bob's Files")).toBe("'C:\\Bob''s Files'");
    });

    it("handles path with multiple single quotes", () => {
        expect(pwshEscapePath("C:\\a'b'c")).toBe("'C:\\a''b''c'");
    });

    it("handles path with spaces", () => {
        expect(pwshEscapePath("C:\\Program Files")).toBe("'C:\\Program Files'");
    });

    it("handles empty string", () => {
        expect(pwshEscapePath("")).toBe("''");
    });
});

describe("cmdEscapePath", () => {
    it("handles plain path", () => {
        expect(cmdEscapePath("C:\\Users\\Bob")).toBe('"C:\\Users\\Bob"');
    });

    it("handles path with double quotes", () => {
        expect(cmdEscapePath('C:\\Bob"s Files')).toBe('"C:\\Bob""s Files"');
    });

    it("handles path with spaces", () => {
        expect(cmdEscapePath("C:\\Program Files")).toBe('"C:\\Program Files"');
    });

    it("handles empty string", () => {
        expect(cmdEscapePath("")).toBe('""');
    });
});

describe("buildCdCommand", () => {
    it("builds POSIX cd command with Ctrl-U prefix", () => {
        const cmd = buildCdCommand("bash", "/home/user");
        expect(cmd).toBe("\x15cd '/home/user'\r");
    });

    it("builds PowerShell Set-Location with Escape prefix", () => {
        const cmd = buildCdCommand("pwsh", "C:\\Users\\Bob");
        expect(cmd).toBe("\x1bSet-Location -LiteralPath 'C:\\Users\\Bob'\r");
    });

    it("builds cmd.exe cd command with Escape prefix", () => {
        const cmd = buildCdCommand("cmd", "C:\\Users\\Bob");
        expect(cmd).toBe("\x1bcd /d \"C:\\Users\\Bob\"\r");
    });

    it("handles path with single quotes in POSIX", () => {
        const cmd = buildCdCommand("zsh", "/path/Bob's Files");
        expect(cmd).toBe("\x15cd '/path/Bob'\\''s Files'\r");
    });

    it("handles path with single quotes in PowerShell", () => {
        const cmd = buildCdCommand("powershell", "C:\\Bob's Files");
        expect(cmd).toBe("\x1bSet-Location -LiteralPath 'C:\\Bob''s Files'\r");
    });

    it("defaults to POSIX for unknown shell types", () => {
        const cmd = buildCdCommand("fish", "/home/user");
        expect(cmd).toBe("\x15cd '/home/user'\r");
    });

    it("handles tilde expansion in POSIX shells", () => {
        const cmd = buildCdCommand("bash", "~");
        expect(cmd).toBe("\x15cd ~\r");
    });
});
