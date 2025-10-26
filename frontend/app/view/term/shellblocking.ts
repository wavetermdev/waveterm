// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Always block (TUIs / pagers / multiplexers / known interactive UIs)
const ALWAYS_BLOCK = [
    // multiplexers
    "tmux", "screen", "byobu", "dtach", "abduco", "tmate",
    // editors/pagers
    "vim", "nvim", "emacs", "nano", "less", "more", "man", "most", "view",
    // TUIs / tools
    "htop", "top", "btop", "fzf", "ranger", "mc", "nnn", "k9s", "nmtui", "alsamixer",
    "tig", "gdb", "lldb",
    // mail/irc
    "mutt", "neomutt", "alpine", "weechat", "irssi",
    // dialog UIs
    "dialog", "whiptail",
    // DB shells
    "psql", "mysql", "sqlite3", "mongo", "redis-cli",
];

// Bare REPLs only block when no args
const BARE_REPLS = [
    "python", "python3", "python2", "node", "ruby", "perl", "php", "lua", "ipython", "bpython", "irb",
];

// Shells: block only if interactive/new shell
const SHELLS = [
    "bash", "sh", "zsh", "fish", "ksh", "mksh", "dash", "ash", "tcsh", "csh",
    "xonsh", "elvish", "nu", "nushell", "pwsh", "powershell", "cmd",
];

// Wrappers to skip
const WRAPPERS = [
    "sudo", "doas", "pkexec", "rlwrap", "env", "time", "nice", "nohup",
    "chrt", "stdbuf", "script", "scriptreplay", "sshpass",
];

function looksInteractiveShellArgs(args: string[]): boolean {
    return (
        args.length === 0 ||
        args.includes("-i") ||
        args.includes("--login") ||
        args.includes("-l") ||
        args.includes("-s")
    );
}

function isNonInteractiveShellExec(args: string[]): boolean {
    return (
        args.includes("-c") ||
        args.some((a) => a === "-Command" || a.startsWith("-Command")) ||
        args.some((a) => a.endsWith(".sh") || a.includes("/"))
    );
}

function isAttachLike(cmd: string, args: string[]): boolean {
    if (cmd === "docker" || cmd === "podman") {
        if (args[0] === "attach") return true;
        if (args[0] === "exec") return args.some((a) => a === "-it" || a === "-i" || a === "-t");
    }
    if (cmd === "kubectl" || cmd === "k3s" || cmd === "oc") {
        if (args[0] === "attach") return true;
        if (args[0] === "exec") return args.some((a) => a === "-it" || a === "-i" || a === "-t");
    }
    if (cmd === "lxc" && args[0] === "exec") return args.some((a) => a === "-t" || a === "-T");
    return false;
}

function isSshInteractive(args: string[]): boolean {
    const hasForcedTty = args.includes("-t") || args.includes("-tt");
    const hasRemoteCmd = args.some((a) => !a.startsWith("-") && a.includes(" "));
    return hasForcedTty || !hasRemoteCmd;
}

export function getBlockingCommand(lastCommand: string | null, inAltBuffer: boolean): string | null {
    if (!lastCommand) return null;

    let words = lastCommand.trim().split(/\s+/);
    if (words.length === 0) return null;

    while (words.length && WRAPPERS.includes(words[0])) {
        words.shift();
    }
    if (!words.length) return null;

    const first = words[0].split("/").pop()!;
    const args = words.slice(1);

    if (inAltBuffer) return first;

    if (ALWAYS_BLOCK.includes(first)) return first;

    if (isAttachLike(first, args)) return first;

    if (first === "ssh" || first === "mosh" || first === "telnet" || first === "rlogin") {
        if (isSshInteractive(args)) return first;
        return null;
    }

    if (first === "su" || first === "machinectl" || first === "chroot" || first === "nsenter" || first === "lxc") {
        if (!args.length || SHELLS.includes(args[args.length - 1]?.split("/").pop() || "")) return first;
        return null;
    }

    if (SHELLS.includes(first)) {
        if (looksInteractiveShellArgs(args)) return first;
        if (isNonInteractiveShellExec(args)) return null;
        return null;
    }

    if (BARE_REPLS.includes(first)) {
        if (args.length === 0) return first;
        return null;
    }

    return null;
}