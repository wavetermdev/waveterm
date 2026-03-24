import { base64ToString } from "@/util/util";
import { describe, expect, it, vi } from "vitest";
import { DefaultMockFilesystem } from "./mockfilesystem";

const { showPreviewContextMenu } = vi.hoisted(() => ({
    showPreviewContextMenu: vi.fn(),
}));

vi.mock("../preview-contextmenu", () => ({
    showPreviewContextMenu,
}));

describe("makeMockWaveEnv", () => {
    it("uses the preview context menu by default", async () => {
        const { makeMockWaveEnv } = await import("./mockwaveenv");
        const env = makeMockWaveEnv();
        const menu = [{ label: "Open" }];
        const event = { stopPropagation: vi.fn() } as any;

        env.showContextMenu(menu, event);

        expect(showPreviewContextMenu).toHaveBeenCalledWith(menu, event);
    });

    it("provides a populated mock filesystem rooted at /Users/mike", () => {
        expect(DefaultMockFilesystem.homePath).toBe("/Users/mike");
        expect(DefaultMockFilesystem.fileCount).toBeGreaterThanOrEqual(100);
        expect(DefaultMockFilesystem.directoryCount).toBeGreaterThanOrEqual(10);
    });

    it("implements file info, read, list, and join commands", async () => {
        const { makeMockWaveEnv } = await import("./mockwaveenv");
        const env = makeMockWaveEnv();

        const bashrcInfo = await env.rpc.FileInfoCommand(null as any, {
            info: { path: "wsh://local//Users/mike/.bashrc" },
        });
        expect(bashrcInfo.path).toBe("/Users/mike/.bashrc");
        expect(bashrcInfo.mimetype).toBe("text/plain");

        const bashrcData = await env.rpc.FileReadCommand(null as any, {
            info: { path: "wsh://local//Users/mike/.bashrc" },
        });
        expect(base64ToString(bashrcData.data64)).toContain('alias gs="git status -sb"');

        const visibleHomeEntries = await env.rpc.FileListCommand(null as any, {
            path: "/Users/mike",
        });
        expect(visibleHomeEntries.some((entry) => entry.name === ".bashrc")).toBe(false);
        expect(visibleHomeEntries.some((entry) => entry.name === "waveterm")).toBe(true);

        const allHomeEntries = await env.rpc.FileListCommand(null as any, {
            path: "/Users/mike",
            opts: { all: true },
        });
        expect(allHomeEntries.some((entry) => entry.name === ".bashrc")).toBe(true);

        const dirRead = await env.rpc.FileReadCommand(null as any, {
            info: { path: "/Users/mike/waveterm" },
        });
        expect(dirRead.entries.some((entry) => entry.name === "docs" && entry.isdir)).toBe(true);

        const joined = await env.rpc.FileJoinCommand(null as any, [
            "wsh://local//Users/mike/Documents",
            "../waveterm/docs",
            "preview-notes.md",
        ]);
        expect(joined.path).toBe("/Users/mike/waveterm/docs/preview-notes.md");
        expect(joined.mimetype).toBe("text/markdown");
    });

    it("implements file list and read stream commands", async () => {
        const { makeMockWaveEnv } = await import("./mockwaveenv");
        const env = makeMockWaveEnv();

        const listPackets: CommandRemoteListEntriesRtnData[] = [];
        for await (const packet of env.rpc.FileListStreamCommand(null as any, {
            path: "/Users/mike",
            opts: { all: true, limit: 4 },
        })) {
            listPackets.push(packet);
        }
        expect(listPackets).toHaveLength(1);
        expect(listPackets[0].fileinfo).toHaveLength(4);
    });

    it("implements secrets commands with in-memory storage", async () => {
        const { makeMockWaveEnv } = await import("./mockwaveenv");
        const env = makeMockWaveEnv({ platform: "linux" });

        await env.rpc.SetSecretsCommand(
            null as any,
            {
                OPENAI_API_KEY: "sk-test",
                ANTHROPIC_API_KEY: "anthropic-test",
            } as any
        );

        expect(await env.rpc.GetSecretsLinuxStorageBackendCommand(null as any)).toBe("libsecret");
        expect(await env.rpc.GetSecretsNamesCommand(null as any)).toEqual(["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
        expect(await env.rpc.GetSecretsCommand(null as any, ["OPENAI_API_KEY", "MISSING_SECRET"])).toEqual({
            OPENAI_API_KEY: "sk-test",
        });

        await env.rpc.SetSecretsCommand(null as any, { OPENAI_API_KEY: null } as any);

        expect(await env.rpc.GetSecretsNamesCommand(null as any)).toEqual(["ANTHROPIC_API_KEY"]);
        expect(await env.rpc.GetSecretsCommand(null as any, ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"])).toEqual({
            ANTHROPIC_API_KEY: "anthropic-test",
        });
    });
});
