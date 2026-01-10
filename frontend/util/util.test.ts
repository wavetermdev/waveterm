// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, describe, test } from "vitest";
import { cmdQuote, powershellQuote, shellQuote, shellQuoteForShellType } from "./util";

describe("shellQuote", () => {
    test("empty string returns empty quoted string", () => {
        assert.equal(shellQuote(""), "''");
    });

    test("simple alphanumeric string is returned as-is", () => {
        assert.equal(shellQuote("simple"), "simple");
        assert.equal(shellQuote("test123"), "test123");
    });

    test("safe path characters are returned as-is", () => {
        assert.equal(shellQuote("path/to/file.txt"), "path/to/file.txt");
        assert.equal(shellQuote("/usr/local/bin"), "/usr/local/bin");
        assert.equal(shellQuote("file-name_v2.0"), "file-name_v2.0");
    });

    test("tilde paths are returned as-is", () => {
        assert.equal(shellQuote("~"), "~");
        assert.equal(shellQuote("~/Documents"), "~/Documents");
        assert.equal(shellQuote("~/.config/wave"), "~/.config/wave");
    });

    test("strings with spaces are single-quoted", () => {
        assert.equal(shellQuote("path with spaces"), "'path with spaces'");
        assert.equal(shellQuote("my file.txt"), "'my file.txt'");
    });

    test("strings with special shell characters are single-quoted", () => {
        assert.equal(shellQuote("$HOME"), "'$HOME'");
        assert.equal(shellQuote("foo;bar"), "'foo;bar'");
        assert.equal(shellQuote("cmd && other"), "'cmd && other'");
        assert.equal(shellQuote("file|pipe"), "'file|pipe'");
        assert.equal(shellQuote("`command`"), "'`command`'");
        assert.equal(shellQuote("$(subshell)"), "'$(subshell)'");
    });

    test("strings with embedded single quotes are properly escaped", () => {
        assert.equal(shellQuote("it's"), "'it'\\''s'");
        assert.equal(shellQuote("don't stop"), "'don'\\''t stop'");
        assert.equal(shellQuote("'quoted'"), "''\\''quoted'\\'''");
    });

    test("strings with double quotes are single-quoted", () => {
        assert.equal(shellQuote('say "hello"'), "'say \"hello\"'");
    });

    test("strings with backslashes are single-quoted", () => {
        assert.equal(shellQuote("back\\slash"), "'back\\slash'");
    });

    test("strings with newlines are single-quoted", () => {
        assert.equal(shellQuote("line1\nline2"), "'line1\nline2'");
    });

    test("strings with tabs are single-quoted", () => {
        assert.equal(shellQuote("col1\tcol2"), "'col1\tcol2'");
    });

    test("complex paths with special characters", () => {
        assert.equal(shellQuote("/path/to/my file (1).txt"), "'/path/to/my file (1).txt'");
        assert.equal(shellQuote("~/My Documents/file.txt"), "'~/My Documents/file.txt'");
    });

    test("prevents command injection", () => {
        // These should all be safely quoted, preventing execution
        assert.equal(shellQuote("; rm -rf /"), "'; rm -rf /'");
        assert.equal(shellQuote("$(whoami)"), "'$(whoami)'");
        assert.equal(shellQuote("`id`"), "'`id`'");
        assert.equal(shellQuote("foo\nbar"), "'foo\nbar'");
        assert.equal(shellQuote("a; echo pwned"), "'a; echo pwned'");
    });
});

describe("powershellQuote", () => {
    test("empty string returns empty quoted string", () => {
        assert.equal(powershellQuote(""), "''");
    });

    test("simple alphanumeric string is returned as-is", () => {
        assert.equal(powershellQuote("simple"), "simple");
        assert.equal(powershellQuote("test123"), "test123");
    });

    test("safe path characters including backslashes and colons are returned as-is", () => {
        assert.equal(powershellQuote("C:\\Users\\test"), "C:\\Users\\test");
        assert.equal(powershellQuote("D:/path/to/file"), "D:/path/to/file");
        assert.equal(powershellQuote("file-name_v2.0"), "file-name_v2.0");
    });

    test("tilde paths are returned as-is", () => {
        assert.equal(powershellQuote("~"), "~");
        assert.equal(powershellQuote("~/Documents"), "~/Documents");
    });

    test("strings with spaces are single-quoted", () => {
        assert.equal(powershellQuote("path with spaces"), "'path with spaces'");
        assert.equal(powershellQuote("C:\\Program Files"), "'C:\\Program Files'");
    });

    test("strings with special PowerShell characters are single-quoted", () => {
        assert.equal(powershellQuote("$HOME"), "'$HOME'");
        assert.equal(powershellQuote("foo;bar"), "'foo;bar'");
        assert.equal(powershellQuote("cmd | other"), "'cmd | other'");
    });

    test("strings with embedded single quotes are escaped by doubling", () => {
        assert.equal(powershellQuote("it's"), "'it''s'");
        assert.equal(powershellQuote("don't stop"), "'don''t stop'");
        assert.equal(powershellQuote("'quoted'"), "'''quoted'''");
    });

    test("strings with double quotes are single-quoted without escaping", () => {
        assert.equal(powershellQuote('say "hello"'), "'say \"hello\"'");
    });

    test("prevents command injection", () => {
        assert.equal(powershellQuote("; Remove-Item -Recurse"), "'; Remove-Item -Recurse'");
        assert.equal(powershellQuote("$(whoami)"), "'$(whoami)'");
        assert.equal(powershellQuote("& cmd"), "'& cmd'");
    });
});

describe("cmdQuote", () => {
    test("empty string returns empty quoted string", () => {
        assert.equal(cmdQuote(""), '""');
    });

    test("simple alphanumeric string is returned as-is", () => {
        assert.equal(cmdQuote("simple"), "simple");
        assert.equal(cmdQuote("test123"), "test123");
    });

    test("safe path characters including backslashes and colons are returned as-is", () => {
        assert.equal(cmdQuote("C:\\Users\\test"), "C:\\Users\\test");
        assert.equal(cmdQuote("D:/path/to/file"), "D:/path/to/file");
        assert.equal(cmdQuote("file-name_v2.0"), "file-name_v2.0");
    });

    test("tilde paths are returned as-is", () => {
        assert.equal(cmdQuote("~"), "~");
        assert.equal(cmdQuote("~/Documents"), "~/Documents");
    });

    test("strings with spaces are double-quoted", () => {
        assert.equal(cmdQuote("path with spaces"), '"path with spaces"');
        assert.equal(cmdQuote("C:\\Program Files"), '"C:\\Program Files"');
    });

    test("strings with special cmd characters are double-quoted", () => {
        assert.equal(cmdQuote("foo&bar"), '"foo&bar"');
        assert.equal(cmdQuote("cmd | other"), '"cmd | other"');
        assert.equal(cmdQuote("a<b>c"), '"a<b>c"');
    });

    test("strings with embedded double quotes are escaped by doubling", () => {
        assert.equal(cmdQuote('say "hello"'), '"say ""hello"""');
        assert.equal(cmdQuote('"quoted"'), '"""quoted"""');
    });

    test("strings with single quotes are double-quoted without escaping", () => {
        assert.equal(cmdQuote("it's"), "\"it's\"");
    });

    test("prevents command injection", () => {
        assert.equal(cmdQuote("& del /s"), '"& del /s"');
        assert.equal(cmdQuote("foo | bar"), '"foo | bar"');
        assert.equal(cmdQuote("a && b"), '"a && b"');
    });
});

describe("shellQuoteForShellType", () => {
    test("uses POSIX quoting for bash", () => {
        assert.equal(shellQuoteForShellType("it's", "bash"), "'it'\\''s'");
    });

    test("uses POSIX quoting for zsh", () => {
        assert.equal(shellQuoteForShellType("it's", "zsh"), "'it'\\''s'");
    });

    test("uses POSIX quoting for sh", () => {
        assert.equal(shellQuoteForShellType("it's", "sh"), "'it'\\''s'");
    });

    test("uses POSIX quoting for fish", () => {
        assert.equal(shellQuoteForShellType("it's", "fish"), "'it'\\''s'");
    });

    test("uses PowerShell quoting for pwsh", () => {
        assert.equal(shellQuoteForShellType("it's", "pwsh"), "'it''s'");
    });

    test("uses PowerShell quoting for powershell", () => {
        assert.equal(shellQuoteForShellType("it's", "powershell"), "'it''s'");
    });

    test("uses PowerShell quoting case-insensitively", () => {
        assert.equal(shellQuoteForShellType("it's", "PowerShell"), "'it''s'");
        assert.equal(shellQuoteForShellType("it's", "PWSH"), "'it''s'");
    });

    test("uses cmd quoting for cmd", () => {
        assert.equal(shellQuoteForShellType('say "hi"', "cmd"), '"say ""hi"""');
    });

    test("uses cmd quoting case-insensitively", () => {
        assert.equal(shellQuoteForShellType('say "hi"', "CMD"), '"say ""hi"""');
    });

    test("uses POSIX quoting for null shell type", () => {
        assert.equal(shellQuoteForShellType("it's", null), "'it'\\''s'");
    });

    test("uses POSIX quoting for undefined shell type", () => {
        assert.equal(shellQuoteForShellType("it's", undefined), "'it'\\''s'");
    });

    test("uses POSIX quoting for unknown shell types", () => {
        assert.equal(shellQuoteForShellType("it's", "unknown"), "'it'\\''s'");
        assert.equal(shellQuoteForShellType("it's", ""), "'it'\\''s'");
    });

    test("handles Windows paths correctly per shell type", () => {
        const windowsPath = "C:\\Program Files\\App";
        assert.equal(shellQuoteForShellType(windowsPath, "pwsh"), "'C:\\Program Files\\App'");
        assert.equal(shellQuoteForShellType(windowsPath, "cmd"), '"C:\\Program Files\\App"');
        assert.equal(shellQuoteForShellType(windowsPath, "bash"), "'C:\\Program Files\\App'");
    });
});
