import { describe, expect, it, vi } from "vitest";

describe("makeWaveEnvImpl", () => {
    it("exposes platform helpers from platformutil", async () => {
        const showContextMenu = vi.fn();
        const windowApi = { name: "electron-api" } as ElectronApi;

        vi.resetModules();
        vi.stubGlobal("window", { api: windowApi });
        vi.doMock("@/app/store/contextmenu", () => ({
            ContextMenuModel: {
                getInstance: () => ({
                    showContextMenu,
                }),
            },
        }));
        vi.doMock("@/app/store/global", () => ({
            atoms: { workspace: "workspace-atom" },
            createBlock: vi.fn(),
            getBlockMetaKeyAtom: vi.fn(),
            getConnStatusAtom: vi.fn(),
            getSettingsKeyAtom: vi.fn(),
            isDev: vi.fn(() => true),
            WOS: { getWaveObjectAtom: vi.fn() },
        }));
        vi.doMock("@/app/store/wshclientapi", () => ({
            RpcApi: { name: "rpc-api" },
        }));
        vi.doMock("@/util/platformutil", () => ({
            PLATFORM: "win32",
            isWindows: vi.fn(() => true),
            isMacOS: vi.fn(() => false),
        }));

        const { makeWaveEnvImpl } = await import("./waveenvimpl");
        const env = makeWaveEnvImpl();

        expect(env.electron).toBe(windowApi);
        expect(env.platform).toBe("win32");
        expect(env.isWindows()).toBe(true);
        expect(env.isMacOS()).toBe(false);
    });
});
