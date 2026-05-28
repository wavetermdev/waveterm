// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    const terminals: any[] = [];
    const imageAddonInstances: any[] = [];
    const controllerInputCommand = vi.fn(async () => undefined);
    const controllerResyncCommand = vi.fn(async () => undefined);

    class MockTerminal {
        rows = 24;
        cols = 80;
        options: any;
        loadedAddons: any[] = [];
        parser = {
            registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })),
            registerCsiHandler: vi.fn(() => ({ dispose: vi.fn() })),
        };
        textarea = {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        };
        buffer = { active: { length: 0 } };
        loadAddon = vi.fn((addon: any) => {
            this.loadedAddons.push(addon);
        });
        open = vi.fn();
        onBell = vi.fn(() => ({ dispose: vi.fn() }));
        attachCustomKeyEventHandler = vi.fn();
        onData = vi.fn(() => ({ dispose: vi.fn() }));
        onSelectionChange = vi.fn(() => ({ dispose: vi.fn() }));
        write = vi.fn((_data: string | Uint8Array, callback?: () => void) => callback?.());
        scrollToBottom = vi.fn();
        clear = vi.fn();
        resize = vi.fn((cols: number, rows: number) => {
            this.cols = cols;
            this.rows = rows;
        });
        paste = vi.fn();
        dispose = vi.fn();
        getSelection = vi.fn(() => "");

        constructor(options: any) {
            this.options = options;
            terminals.push(this);
        }
    }

    class MockFitAddon {
        fit = vi.fn();
    }

    class MockSearchAddon {
        clearDecorations = vi.fn();
        onDidChangeResults = vi.fn(() => ({ dispose: vi.fn() }));
    }

    class MockSerializeAddon {
        serialize = vi.fn(() => "");
    }

    class MockWebLinksAddon {
        constructor(
            public readonly activate: (event: MouseEvent, uri: string) => void,
            public readonly options: Record<string, unknown>
        ) {}
    }

    class MockWebglAddon {
        onContextLoss = vi.fn(() => ({ dispose: vi.fn() }));
        dispose = vi.fn();
    }

    const ImageAddon = vi.fn(function MockImageAddon(this: any, options: any) {
        this.options = options;
        imageAddonInstances.push(this);
    });

    return {
        terminals,
        imageAddonInstances,
        controllerInputCommand,
        controllerResyncCommand,
        MockTerminal,
        MockFitAddon,
        MockSearchAddon,
        MockSerializeAddon,
        MockWebLinksAddon,
        MockWebglAddon,
        ImageAddon,
    };
});

vi.mock("@xterm/xterm", () => ({
    Terminal: mocks.MockTerminal,
}));

vi.mock("@xterm/addon-fit", () => ({
    FitAddon: mocks.MockFitAddon,
}));

vi.mock("@xterm/addon-search", () => ({
    SearchAddon: mocks.MockSearchAddon,
}));

vi.mock("@xterm/addon-serialize", () => ({
    SerializeAddon: mocks.MockSerializeAddon,
}));

vi.mock("@xterm/addon-web-links", () => ({
    WebLinksAddon: mocks.MockWebLinksAddon,
}));

vi.mock("@xterm/addon-webgl", () => ({
    WebglAddon: mocks.MockWebglAddon,
}));

vi.mock("@xterm/addon-image", () => ({
    ImageAddon: mocks.ImageAddon,
}));

vi.mock("@/app/store/badge", () => ({
    setBadge: vi.fn(),
}));

vi.mock("@/app/store/wps", () => ({
    getFileSubject: vi.fn(() => ({
        subscribe: vi.fn(),
        release: vi.fn(),
    })),
}));

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        ControllerInputCommand: mocks.controllerInputCommand,
        ControllerResyncCommand: mocks.controllerResyncCommand,
        ElectronSystemBellCommand: vi.fn(async () => undefined),
        GetRTInfoCommand: vi.fn(async () => null),
        WriteTempFileCommand: vi.fn(async () => "/tmp/mock-image.png"),
    },
}));

vi.mock("@/app/store/wshrpcutil", () => ({
    TabRpcClient: {},
}));

vi.mock("@/store/global", () => ({
    fetchWaveFile: vi.fn(async () => ({ data: new Uint8Array(), fileInfo: null })),
    getOverrideConfigAtom: vi.fn(() => ({})),
    getSettingsKeyAtom: vi.fn(() => ({})),
    globalStore: {
        get: vi.fn(() => null),
        set: vi.fn(),
    },
    isDev: vi.fn(() => false),
    openLink: vi.fn(async () => undefined),
    WOS: {
        makeORef: vi.fn((_otype: string, oid: string) => `block:${oid}`),
    },
}));

vi.mock("@/store/services", () => ({
    BlockService: {
        SaveTerminalState: vi.fn(async () => undefined),
    },
}));

vi.mock("@/util/platformutil", () => ({
    PLATFORM: "linux",
    PlatformMacOS: "darwin",
}));

vi.mock("@/util/util", () => ({
    base64ToArray: vi.fn(() => new Uint8Array()),
    fireAndForget: vi.fn((fn?: () => Promise<unknown> | unknown) => {
        if (typeof fn === "function") {
            void fn();
        }
    }),
}));

vi.mock("./osc-handlers", () => ({
    handleOsc16162Command: vi.fn(() => true),
    handleOsc52Command: vi.fn(() => true),
    handleOsc7Command: vi.fn(() => true),
}));

vi.mock("./termutil", () => ({
    bufferLinesToText: vi.fn(() => []),
    createTempFileFromBlob: vi.fn(async () => "/tmp/mock-image.png"),
    extractAllClipboardData: vi.fn(async () => []),
    normalizeCursorStyle: vi.fn((cursorStyle: string) => cursorStyle ?? "block"),
}));

describe("TermWrap sixel addon wiring", () => {
    const makeConnectElem = () =>
        ({
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            querySelector: vi.fn(() => null),
            getBoundingClientRect: vi.fn(() => ({ width: 0, height: 0 })),
        }) as any;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.terminals.length = 0;
        mocks.imageAddonInstances.length = 0;
        (globalThis as any).document = {
            activeElement: null,
            createElement: vi.fn((tagName: string) => {
                if (tagName === "canvas") {
                    return {
                        getContext: vi.fn(() => null),
                    };
                }
                return {
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                    querySelector: vi.fn(() => null),
                    getBoundingClientRect: vi.fn(() => ({ width: 0, height: 0 })),
                };
            }),
            hasFocus: vi.fn(() => true),
        };
    });

    it("loads ImageAddon by default when sixel is not explicitly disabled", async () => {
        const { TermWrap } = await import("./termwrap");

        new TermWrap("tab-1", "block-1", makeConnectElem(), {} as any, {} as any);

        expect(mocks.ImageAddon).toHaveBeenCalledWith({
            enableSizeReports: true,
            sixelSupport: true,
            iipSupport: false,
            kittySupport: false,
        });
        expect(mocks.terminals[0]?.loadAddon).toHaveBeenCalledWith(mocks.imageAddonInstances[0]);
    });

    it("does not load ImageAddon when sixel is explicitly disabled", async () => {
        const { TermWrap } = await import("./termwrap");

        new TermWrap("tab-1", "block-1", makeConnectElem(), {} as any, { useSixel: false } as any);

        expect(mocks.ImageAddon).not.toHaveBeenCalled();
        expect(mocks.terminals[0]?.loadedAddons.some((addon) => mocks.imageAddonInstances.includes(addon))).toBe(false);
    });
});
