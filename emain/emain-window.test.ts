// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WaveBrowserWindow } from "./emain-window";

const platform = vi.hoisted(() => ({ isDev: true }));
vi.mock("./emain-platform", () => platform);
vi.mock("electron", () => ({ BaseWindow: class {}, ipcMain: { on: vi.fn(), handle: vi.fn() } }));
vi.mock("@/app/store/services", () => ({ ClientService: { GetClientData: async () => ({ oid: "client" }) } }));
vi.mock("@/app/store/wps", () => ({}));
vi.mock("@/app/store/wshclientapi", () => ({}));
vi.mock("@/util/util", () => ({}));
vi.mock("emain/emain-events", () => ({}));
vi.mock("./emain-activity", () => ({}));
vi.mock("./emain-log", () => ({}));
vi.mock("./emain-tabview", () => ({}));
vi.mock("./emain-util", () => ({}));
vi.mock("./emain-wsh", () => ({}));
vi.mock("./updater", () => ({}));

function deferred() {
    let resolve: () => void;
    let reject: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function makeWindowAndTab() {
    // Exercise the real initialization methods without launching Electron in a unit test.
    const window = Object.create(WaveBrowserWindow.prototype);
    const events = new EventEmitter();
    window.once = events.once.bind(events);
    window.removeListener = events.removeListener.bind(events);
    window.isDestroyed = vi.fn(() => false);
    window.isVisible = vi.fn(() => false);
    window.show = vi.fn();
    window.getContentBounds = () => ({ width: 800, height: 600 });
    window.contentView = { addChildView: vi.fn() };
    window.waveWindowId = "window";
    const bare = deferred();
    const wave = deferred();
    const wc = Object.assign(new EventEmitter(), {
        isDestroyed: vi.fn(() => false),
        isDevToolsOpened: vi.fn(() => false),
        openDevTools: vi.fn(),
        send: vi.fn(),
    });
    const tab = {
        waveTabId: "tab",
        isDestroyed: false,
        initPromise: bare.promise,
        waveReadyPromise: wave.promise,
        webContents: wc,
        setBounds: vi.fn(),
        savedInitOpts: null,
    };
    window.activeTabView = tab;
    return { window, events, tab, wc, bare, wave };
}

function expectCleanedUp(events: EventEmitter, wc: EventEmitter) {
    expect(vi.getTimerCount()).toBe(0);
    expect(events.listenerCount("closed")).toBe(0);
    expect(wc.listenerCount("destroyed")).toBe(0);
    expect(wc.listenerCount("render-process-gone")).toBe(0);
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    platform.isDev = true;
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("renderer startup diagnostics", () => {
    it("continues wave-init and completes after both five-second thresholds", async () => {
        const { window, events, tab, wc, bare, wave } = makeWindowAndTab();
        const finished = vi.fn();
        const startup = window.initializeTab(tab, true).then(finished);
        await vi.advanceTimersByTimeAsync(5001);
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining("initPromise still pending after 5000ms"));
        expect(window.show).toHaveBeenCalledOnce();
        expect(wc.openDevTools).toHaveBeenCalledOnce();
        expect(wc.send).not.toHaveBeenCalled();
        expect(finished).not.toHaveBeenCalled();

        bare.resolve();
        await vi.advanceTimersByTimeAsync(0);
        expect(window.contentView.addChildView).toHaveBeenCalledWith(tab);
        expect(wc.send).toHaveBeenCalledExactlyOnceWith("wave-init", {
            tabId: "tab",
            clientId: "client",
            windowId: "window",
            activate: true,
            primaryTabStartup: true,
        });
        expect(tab.savedInitOpts).toEqual({ tabId: "tab", clientId: "client", windowId: "window", activate: false });
        await vi.advanceTimersByTimeAsync(5001);
        expect(console.log).toHaveBeenCalledWith(
            expect.stringContaining("waveReadyPromise still pending after 5000ms")
        );
        expect(finished).not.toHaveBeenCalled();
        wave.resolve();
        await startup;
        expect(finished).toHaveBeenCalledOnce();
        expectCleanedUp(events, wc);
    });

    it("does not warn for a ready hot spare and fast wave-ready", async () => {
        const { window, events, tab, wc, bare, wave } = makeWindowAndTab();
        bare.resolve();
        wave.resolve();
        await window.initializeTab(tab, false);
        await vi.advanceTimersByTimeAsync(6000);
        expect(wc.send).toHaveBeenCalledOnce();
        expect(window.show).not.toHaveBeenCalled();
        expect(wc.openDevTools).not.toHaveBeenCalled();
        expectCleanedUp(events, wc);
    });

    it("opens diagnostics on the awaited renderer, not a different active tab", async () => {
        const { window, events, tab, wc, bare } = makeWindowAndTab();
        const otherTools = vi.fn();
        window.activeTabView = { webContents: { openDevTools: otherTools } };
        const wait = window.awaitWithDevDiagnostics(bare.promise, "initPromise", tab);
        await vi.advanceTimersByTimeAsync(5001);
        expect(wc.openDevTools).toHaveBeenCalledOnce();
        expect(otherTools).not.toHaveBeenCalled();
        bare.resolve();
        await wait;
        expectCleanedUp(events, wc);
    });

    it.each(["initPromise", "waveReadyPromise"])("propagates %s rejection even after diagnostics", async (name) => {
        const { window, events, tab, wc } = makeWindowAndTab();
        const ready = deferred();
        const failure = new Error("renderer initialization failed");
        const wait = window.awaitWithDevDiagnostics(ready.promise, name, tab);
        const rejected = expect(wait).rejects.toBe(failure);
        await vi.advanceTimersByTimeAsync(5001);
        ready.reject(failure);
        await rejected;
        expectCleanedUp(events, wc);
    });

    it.each([
        ["initPromise", "closed"],
        ["initPromise", "destroyed"],
        ["initPromise", "render-process-gone"],
        ["waveReadyPromise", "closed"],
        ["waveReadyPromise", "destroyed"],
        ["waveReadyPromise", "render-process-gone"],
    ])("aborts %s on %s and ignores late readiness", async (name, event) => {
        const { window, events, tab, wc, bare, wave } = makeWindowAndTab();
        if (name === "waveReadyPromise") {
            bare.resolve();
        }
        const startup = window.initializeTab(tab, false);
        const rejected = expect(startup).rejects.toThrow(`[dev] ${name} aborted:`);
        await vi.advanceTimersByTimeAsync(5001);
        (event === "closed" ? events : wc).emit(event, {}, { reason: "crashed" });
        await rejected;
        bare.resolve();
        wave.resolve();
        await vi.advanceTimersByTimeAsync(6000);
        expect(wc.send).toHaveBeenCalledTimes(name === "initPromise" ? 0 : 1);
        expect(window.show).toHaveBeenCalledOnce();
        expectCleanedUp(events, wc);
    });

    it("warns only once while a live renderer remains stalled", async () => {
        const { window, events, tab, wc, bare } = makeWindowAndTab();
        const wait = window.awaitWithDevDiagnostics(bare.promise, "initPromise", tab);
        await vi.advanceTimersByTimeAsync(60000);
        expect(window.show).toHaveBeenCalledOnce();
        expect(wc.openDevTools).toHaveBeenCalledOnce();
        expect(console.log).toHaveBeenCalledOnce();
        bare.resolve();
        await wait;
        expectCleanedUp(events, wc);
    });

    it("rejects an already destroyed renderer without starting diagnostics", async () => {
        const { window, events, tab, wc, bare } = makeWindowAndTab();
        wc.isDestroyed.mockReturnValue(true);
        await expect(window.awaitWithDevDiagnostics(bare.promise, "initPromise", tab)).rejects.toThrow(
            "destroyed tab/window"
        );
        expectCleanedUp(events, wc);
    });

    it("leaves production waiting behavior unchanged", async () => {
        platform.isDev = false;
        const { window, events, tab, wc, bare } = makeWindowAndTab();
        const wait = window.awaitWithDevDiagnostics(bare.promise, "initPromise", tab);
        await vi.advanceTimersByTimeAsync(10000);
        expect(window.show).not.toHaveBeenCalled();
        expect(wc.openDevTools).not.toHaveBeenCalled();
        expectCleanedUp(events, wc);
        bare.resolve();
        await wait;
    });
});
