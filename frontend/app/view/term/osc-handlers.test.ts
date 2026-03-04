import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockWriteText, mockGet } = vi.hoisted(() => ({
    mockWriteText: vi.fn(),
    mockGet: vi.fn(),
}));

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/store/services", () => ({}));
vi.mock("@/store/global", () => ({
    getApi: vi.fn(),
    getBlockMetaKeyAtom: vi.fn(),
    getBlockTermDurableAtom: vi.fn(),
    getOverrideConfigAtom: vi.fn((_blockId: string, key: string) => ({ key })),
    globalStore: { get: mockGet },
    recordTEvent: vi.fn(),
    WOS: {},
}));
vi.mock("@/util/util", () => ({
    base64ToString: (data: string) => Buffer.from(data, "base64").toString("utf8"),
    fireAndForget: (fn: () => Promise<void>) => {
        void fn();
    },
    isSshConnName: vi.fn(),
    isWslConnName: vi.fn(),
}));

import { handleOsc52Command } from "./osc-handlers";

describe("handleOsc52Command", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockWriteText.mockResolvedValue(undefined);
        Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: { clipboard: { writeText: mockWriteText } },
        });
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: { hasFocus: () => true },
        });
    });

    it("rejects unfocused block when term:osc52 is focus", () => {
        mockGet.mockImplementation((atom: { key?: string } | undefined) => {
            if (atom?.key === "term:osc52") {
                return "focus";
            }
            return false;
        });

        handleOsc52Command("c;SGVsbG8=", "block-1", true, { nodeModel: { isFocused: {} } } as any);

        expect(mockWriteText).not.toHaveBeenCalled();
    });

    it("allows unfocused block when term:osc52 is always", async () => {
        mockGet.mockImplementation((atom: { key?: string } | undefined) => {
            if (atom?.key === "term:osc52") {
                return "always";
            }
            return false;
        });

        handleOsc52Command("c;SGVsbG8=", "block-1", true, { nodeModel: { isFocused: {} } } as any);
        await Promise.resolve();

        expect(mockWriteText).toHaveBeenCalledWith("Hello");
    });

    it("allows write when term:osc52 is always and window is unfocused", async () => {
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: { hasFocus: () => false },
        });
        mockGet.mockImplementation((atom: { key?: string } | undefined) => {
            if (atom?.key === "term:osc52") {
                return "always";
            }
            return false;
        });

        handleOsc52Command("c;SGVsbG8=", "block-1", true, { nodeModel: { isFocused: {} } } as any);
        await Promise.resolve();

        expect(mockWriteText).toHaveBeenCalledWith("Hello");
    });

    it("defaults term:osc52 to always when unset", async () => {
        Object.defineProperty(globalThis, "document", {
            configurable: true,
            value: { hasFocus: () => false },
        });
        mockGet.mockImplementation((atom: { key?: string } | undefined) => {
            if (atom?.key === "term:osc52") {
                return undefined;
            }
            return false;
        });

        handleOsc52Command("c;SGVsbG8=", "block-1", true, { nodeModel: { isFocused: {} } } as any);
        await Promise.resolve();

        expect(mockWriteText).toHaveBeenCalledWith("Hello");
    });
});
