import { describe, expect, it, vi } from "vitest";

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
});
