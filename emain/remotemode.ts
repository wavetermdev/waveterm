// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_PORT = 31577;

export type RemoteTarget = { host: string; port: number };

export type RemoteModeState = {
    isRemote: boolean;
    target: RemoteTarget | null;
    password: string | null;
    safeSuffix: string | null; // e.g. "host_example_com-31577"
};

function parseRemoteHostArg(argv: string[]): RemoteTarget | null {
    let value: string | null = null;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--remote-host") {
            value = argv[i + 1] ?? null;
            break;
        }
        if (a.startsWith("--remote-host=")) {
            value = a.slice("--remote-host=".length);
            break;
        }
    }
    if (!value) return null;
    const idx = value.lastIndexOf(":");
    if (idx < 0) {
        return { host: value, port: DEFAULT_PORT };
    }
    const host = value.slice(0, idx);
    const port = parseInt(value.slice(idx + 1), 10);
    if (!host || isNaN(port) || port <= 0 || port > 65535) {
        throw new Error(`invalid --remote-host value: ${value}`);
    }
    return { host, port };
}

function readPasswordFromSettings(settingsDir: string): string | null {
    const p = path.join(settingsDir, "settings.json");
    if (!fs.existsSync(p)) return null;
    try {
        const raw = fs.readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw);
        const v = parsed["remote:password"];
        return typeof v === "string" && v.length > 0 ? v : null;
    } catch {
        return null;
    }
}

function safeSuffixFor(target: RemoteTarget): string {
    return `${target.host}-${target.port}`.replace(/[^a-z0-9-]/gi, "_");
}

// Resolve once at startup. Callers pass the local config dir explicitly
// (not derived from getWaveConfigDir, because that may already account for
// the remote-mode userData path).
export function resolveRemoteMode(argv: string[], localConfigDir: string): RemoteModeState {
    const target = parseRemoteHostArg(argv);
    if (target == null) {
        return { isRemote: false, target: null, password: null, safeSuffix: null };
    }
    const password = readPasswordFromSettings(localConfigDir);
    return {
        isRemote: true,
        target,
        password,
        safeSuffix: safeSuffixFor(target),
    };
}
