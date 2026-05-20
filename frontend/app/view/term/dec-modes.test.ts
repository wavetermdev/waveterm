import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks for heavy dependencies so TermWrap can be instantiated in Node.js
// ---------------------------------------------------------------------------

const mockWrite = vi.fn();
const mockScrollToBottom = vi.fn();
const mockOpen = vi.fn();
const mockDispose = vi.fn();
const capturedCsiHandlers: Record<string, Function> = {};

vi.mock("@xterm/xterm", () => ({
    Terminal: class MockTerminal {
        write = mockWrite;
        scrollToBottom = mockScrollToBottom;
        rows = 24;
        cols = 80;
        parser = {
            registerCsiHandler: vi.fn((id: { prefix?: string; final: string }, cb: Function) => {
                const key = (id.prefix ?? "") + id.final;
                capturedCsiHandlers[key] = cb;
                return { dispose: mockDispose };
            }),
            registerOscHandler: vi.fn(() => ({ dispose: mockDispose })),
        };
        open = mockOpen;
        loadAddon = vi.fn();
        attachCustomKeyEventHandler = vi.fn();
        onBell = vi.fn(() => ({ dispose: mockDispose }));
        onData = vi.fn(() => ({ dispose: mockDispose }));
        onBinary = vi.fn(() => ({ dispose: mockDispose }));
        onTitleChange = vi.fn(() => ({ dispose: mockDispose }));
        onRender = vi.fn(() => ({ dispose: mockDispose }));
        onResize = vi.fn(() => ({ dispose: mockDispose }));
        onWriteParsed = vi.fn(() => ({ dispose: mockDispose }));
        onSelectionChange = vi.fn(() => ({ dispose: mockDispose }));
    },
}));

vi.mock("@xterm/addon-fit", () => ({ FitAddon: class MockFitAddon { fit = vi.fn(); } }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class MockSearchAddon {} }));
vi.mock("@xterm/addon-serialize", () => ({ SerializeAddon: class MockSerializeAddon {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class MockWebLinksAddon {} }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class MockWebglAddon {} }));

vi.mock("@/store/global", () => ({
    globalStore: {
        get: vi.fn(() => undefined),
        set: vi.fn(),
        sub: vi.fn(() => () => {}),
    },
    getApi: vi.fn(() => ({})),
    getOverrideConfigAtom: vi.fn(() => vi.fn()),
    getSettingsKeyAtom: vi.fn(() => vi.fn()),
    isDev: false,
    openLink: vi.fn(),
    WOS: {},
    fetchWaveFile: vi.fn(),
}));

vi.mock("@/store/services", () => ({
    BlockService: {
        SaveTerminalState: vi.fn(),
    },
}));

vi.mock("@/app/store/badge", () => ({ setBadge: vi.fn() }));
vi.mock("@/app/store/wps", () => ({ getFileSubject: vi.fn(() => null) }));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("@/util/platformutil", () => ({ PLATFORM: "darwin", PlatformMacOS: true }));
vi.mock("@/util/util", () => ({ base64ToArray: vi.fn(), fireAndForget: vi.fn((f) => f()) }));
vi.mock("debug", () => ({ default: () => vi.fn() }));
vi.mock("jotai", () => ({
    atom: vi.fn((init) => ({ init })),
    PrimitiveAtom: class MockPrimitiveAtom {},
}));
vi.mock("throttle-debounce", () => ({ debounce: vi.fn((_, fn) => fn) }));
vi.mock("./osc-handlers", () => ({
    handleOsc16162Command: vi.fn(),
    handleOsc52Command: vi.fn(),
    handleOsc7Command: vi.fn(),
    isClaudeCodeCommand: vi.fn(),
}));
vi.mock("./termutil", () => ({
    bufferLinesToText: vi.fn(),
    createTempFileFromBlob: vi.fn(),
    extractAllClipboardData: vi.fn(),
    normalizeCursorStyle: vi.fn(),
    quoteForPosixShell: vi.fn(),
    trimTerminalSelection: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { TermWrap } from "./termwrap";

describe("TermWrap DEC mode tracking", () => {
    let term: TermWrap;

    beforeEach(() => {
        mockWrite.mockClear();
        mockScrollToBottom.mockClear();
        mockOpen.mockClear();
        mockDispose.mockClear();
        Object.keys(capturedCsiHandlers).forEach((k) => delete capturedCsiHandlers[k]);

        const mockElem = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            style: {},
        } as unknown as HTMLDivElement;

        term = new TermWrap(
            "tab-1",
            "block-1",
            mockElem,
            {},
            {}
        );
    });

    describe("serializeDecModes", () => {
        it("returns empty string when no modes are tracked", () => {
            expect(term.serializeDecModes()).toBe("");
        });

        it("returns comma-separated sorted modes", () => {
            term.activeDecModes.add(1003);
            term.activeDecModes.add(1000);
            term.activeDecModes.add(1002);
            expect(term.serializeDecModes()).toBe("1000,1002,1003");
        });
    });

    describe("replayDecModes", () => {
        it("writes nothing for empty string", () => {
            term.replayDecModes("");
            expect(mockWrite).not.toHaveBeenCalled();
        });

        it("replays safe modes (mouse + bracketed paste)", () => {
            term.replayDecModes("1002,1003,2004");
            expect(mockWrite).toHaveBeenCalledTimes(1);
            expect(mockWrite).toHaveBeenCalledWith("\x1b[?1002h\x1b[?1003h\x1b[?2004h");
        });

        it("filters out unsafe modes (alternate screen, cursor, sync)", () => {
            term.replayDecModes("47,1002,1049,25,2026,1003");
            expect(mockWrite).toHaveBeenCalledTimes(1);
            // Only 1002 and 1003 should be written
            expect(mockWrite).toHaveBeenCalledWith("\x1b[?1002h\x1b[?1003h");
        });

        it("handles malformed input gracefully", () => {
            term.replayDecModes("abc,1002,,1003,NaN");
            expect(mockWrite).toHaveBeenCalledTimes(1);
            expect(mockWrite).toHaveBeenCalledWith("\x1b[?1002h\x1b[?1003h");
        });
    });

    describe("CSI ? h (set) handler", () => {
        it("tracks all modes in a multi-parameter sequence", () => {
            const handler = capturedCsiHandlers["?h"];
            expect(handler).toBeDefined();
            handler([1002, 1003, 1006]);
            expect(term.activeDecModes.has(1002)).toBe(true);
            expect(term.activeDecModes.has(1003)).toBe(true);
            expect(term.activeDecModes.has(1006)).toBe(true);
        });

        it("sets inSyncTransaction when mode 2026 is present", () => {
            const handler = capturedCsiHandlers["?h"];
            expect(term.inSyncTransaction).toBe(false);
            handler([2026]);
            expect(term.inSyncTransaction).toBe(true);
        });

        it("returns false to let xterm.js default handler run", () => {
            const handler = capturedCsiHandlers["?h"];
            expect(handler([1002])).toBe(false);
        });
    });

    describe("CSI ? l (reset) handler", () => {
        it("removes all modes in a multi-parameter sequence", () => {
            const setHandler = capturedCsiHandlers["?h"];
            setHandler([1002, 1003, 1006]);

            const resetHandler = capturedCsiHandlers["?l"];
            expect(resetHandler).toBeDefined();
            resetHandler([1002, 1003]);

            expect(term.activeDecModes.has(1002)).toBe(false);
            expect(term.activeDecModes.has(1003)).toBe(false);
            expect(term.activeDecModes.has(1006)).toBe(true);
        });

        it("clears inSyncTransaction when mode 2026 is reset", () => {
            const setHandler = capturedCsiHandlers["?h"];
            setHandler([2026]);
            expect(term.inSyncTransaction).toBe(true);

            const resetHandler = capturedCsiHandlers["?l"];
            resetHandler([2026]);
            expect(term.inSyncTransaction).toBe(false);
        });

        it("clears all modes when no parameters are provided", () => {
            const setHandler = capturedCsiHandlers["?h"];
            setHandler([1002, 1003]);
            expect(term.activeDecModes.size).toBe(2);

            const resetHandler = capturedCsiHandlers["?l"];
            resetHandler([]);
            expect(term.activeDecModes.size).toBe(0);
        });

        it("returns false to let xterm.js default handler run", () => {
            const resetHandler = capturedCsiHandlers["?l"];
            expect(resetHandler([1002])).toBe(false);
        });
    });

    describe("full round-trip", () => {
        it("serializes and replays only safe modes after mixed tracking", () => {
            const setHandler = capturedCsiHandlers["?h"];
            setHandler([47, 1002, 1049, 2004]);

            const serialized = term.serializeDecModes();
            expect(serialized).toBe("47,1002,1049,2004");

            term.replayDecModes(serialized);
            expect(mockWrite).toHaveBeenCalledWith("\x1b[?1002h\x1b[?2004h");
        });
    });
});
