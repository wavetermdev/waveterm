import { describe, expect, it, vi } from "vitest";

describe("ContextMenuModel", () => {
    it("initializes only when getInstance is called", async () => {
        let contextMenuCallback: (id: string | null) => void;
        const onContextMenuClick = vi.fn();
        onContextMenuClick.mockImplementation((callback) => {
            contextMenuCallback = callback;
        });
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
        expect(contextMenuCallback).toBeTypeOf("function");
    });

    it("runs select and close callbacks after item handler", async () => {
        let contextMenuCallback: (id: string | null) => void;
        const showContextMenu = vi.fn();
        const onContextMenuClick = vi.fn((callback) => {
            contextMenuCallback = callback;
        });
        const getApi = vi.fn(() => ({
            onContextMenuClick,
            showContextMenu,
        }));
        const workspace = { oid: "workspace-1" };

        vi.resetModules();
        vi.doMock("./global", () => ({
            atoms: { workspace: "workspace", builderId: "builderId" },
            getApi,
            globalStore: {
                get: vi.fn((atom) => {
                    if (atom === "workspace") {
                        return workspace;
                    }
                    return "builder-1";
                }),
            },
        }));

        const { ContextMenuModel } = await import("./contextmenu");
        const model = ContextMenuModel.getInstance();
        const order: string[] = [];
        const itemClick = vi.fn(() => {
            order.push("item");
        });
        const onSelect = vi.fn((item) => {
            order.push(`select:${item.label}`);
        });
        const onClose = vi.fn((item) => {
            order.push(`close:${item?.label ?? "null"}`);
        });

        model.showContextMenu(
            [{ label: "Open", click: itemClick }],
            { stopPropagation: vi.fn() } as any,
            { onSelect, onClose }
        );
        const menuId = showContextMenu.mock.calls[0][1][0].id;
        contextMenuCallback(menuId);

        expect(order).toEqual(["item", "select:Open", "close:Open"]);
        expect(itemClick).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("runs cancel and close callbacks when no item is selected", async () => {
        let contextMenuCallback: (id: string | null) => void;
        const showContextMenu = vi.fn();
        const onContextMenuClick = vi.fn((callback) => {
            contextMenuCallback = callback;
        });
        const getApi = vi.fn(() => ({
            onContextMenuClick,
            showContextMenu,
        }));
        const workspace = { oid: "workspace-1" };

        vi.resetModules();
        vi.doMock("./global", () => ({
            atoms: { workspace: "workspace", builderId: "builderId" },
            getApi,
            globalStore: {
                get: vi.fn((atom) => {
                    if (atom === "workspace") {
                        return workspace;
                    }
                    return "builder-1";
                }),
            },
        }));

        const { ContextMenuModel } = await import("./contextmenu");
        const model = ContextMenuModel.getInstance();
        const order: string[] = [];
        const onCancel = vi.fn(() => {
            order.push("cancel");
        });
        const onClose = vi.fn((item) => {
            order.push(`close:${item == null ? "null" : item.label}`);
        });

        model.showContextMenu(
            [{ label: "Open", click: vi.fn() }],
            { stopPropagation: vi.fn() } as any,
            { onCancel, onClose }
        );
        contextMenuCallback(null);

        expect(order).toEqual(["cancel", "close:null"]);
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
