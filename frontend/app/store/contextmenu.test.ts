import { describe, expect, it, vi } from "vitest";

describe("ContextMenuModel", () => {
    it("initializes only when getInstance is called", async () => {
        const onContextMenuClick = vi.fn();
        const getApi = vi.fn(() => ({
            onContextMenuClick,
            showContextMenu: vi.fn(),
        }));

        vi.resetModules();
        vi.doMock("./global", () => ({
            atoms: {},
            getApi,
            globalStore: { get: vi.fn() },
        }));

        const { ContextMenuModel } = await import("./contextmenu");
        expect(getApi).not.toHaveBeenCalled();

        const firstInstance = ContextMenuModel.getInstance();
        const secondInstance = ContextMenuModel.getInstance();

        expect(firstInstance).toBe(secondInstance);
        expect(getApi).toHaveBeenCalledTimes(1);
        expect(onContextMenuClick).toHaveBeenCalledTimes(1);
    });
});
