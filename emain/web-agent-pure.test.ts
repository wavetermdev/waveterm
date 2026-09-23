// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";

import {
    ERR_BROWSER_CONTROL_DISABLED,
    ERR_REMOTE_TO_LOCAL_DISABLED,
    ERR_WEB_RUN_ABORTED,
    JS_RESULT_MAX_BYTES,
    SLEEP_CAP_MS,
    SNAPSHOT_MAX_BYTES,
    SNAPSHOT_MAX_LINES,
    WEB_RUN_MAX_SCRIPT_BYTES,
    applyNavigateCdpEvent,
    assignNavigateLoaderId,
    assertWebAgentControlDecision,
    axValue,
    capSleepMs,
    checkScriptSize,
    clientRectCenter,
    contentQuadCenter,
    createAbortableSend,
    emptyNavigateWaitState,
    formatAxSnapshot,
    isClickPoint,
    isLocalConnName,
    isNavigateAbortedError,
    isRemoteOrigin,
    isUsableWebContentsId,
    isWslConnName,
    missingBackendNodeError,
    originConnFromRpcSource,
    pageNavigateStrategy,
    parseRef,
    scriptContainsSecretCall,
    selectAllKeyModifiers,
    selectAllModifier,
    shouldAllowRemoteLocalControl,
    shouldCompleteNavigate,
    splitTypeChunks,
    staleRefError,
    stringifyPrintArg,
    truncateJsonValue,
    urlsMatchForNavigate,
    type AxNode,
    type NavigateWaitState,
} from "./web-agent-pure";

function node(partial: AxNode): AxNode {
    return partial;
}

describe("conn name predicates", () => {
    it("treats empty, local, and local:* as local", () => {
        expect(isLocalConnName("")).toBe(true);
        expect(isLocalConnName("local")).toBe(true);
        expect(isLocalConnName("local:foo")).toBe(true);
        expect(isLocalConnName("host1")).toBe(false);
        expect(isLocalConnName("wsl://Ubuntu")).toBe(false);
    });

    it("treats wsl:// as WSL", () => {
        expect(isWslConnName("wsl://Ubuntu")).toBe(true);
        expect(isWslConnName("local")).toBe(false);
        expect(isWslConnName("")).toBe(false);
    });

    it("matches Go isRemoteOrigin", () => {
        expect(isRemoteOrigin("")).toBe(false);
        expect(isRemoteOrigin("local")).toBe(false);
        expect(isRemoteOrigin("local:foo")).toBe(false);
        expect(isRemoteOrigin("wsl://Ubuntu")).toBe(false);
        expect(isRemoteOrigin("host1")).toBe(true);
        expect(isRemoteOrigin("user@host1:22")).toBe(true);
    });
});

describe("shouldAllowRemoteLocalControl", () => {
    it("allows local origin targeting local even when the setting is off", () => {
        expect(shouldAllowRemoteLocalControl("", "", false)).toBe(true);
        expect(shouldAllowRemoteLocalControl("local", "", false)).toBe(true);
        expect(shouldAllowRemoteLocalControl("local", "local:foo", false)).toBe(true);
    });

    it("denies remote origin targeting local when the setting is off", () => {
        expect(shouldAllowRemoteLocalControl("host1", "", false)).toBe(false);
        expect(shouldAllowRemoteLocalControl("host1", "local:foo", false)).toBe(false);
    });

    it("allows remote origin targeting local when the setting is on", () => {
        expect(shouldAllowRemoteLocalControl("host1", "", true)).toBe(true);
    });

    it("allows remote origin targeting a remote host regardless of the setting", () => {
        expect(shouldAllowRemoteLocalControl("host1", "host2", false)).toBe(true);
    });

    it("allows WSL origin targeting local when the setting is off", () => {
        expect(shouldAllowRemoteLocalControl("wsl://Ubuntu", "", false)).toBe(true);
    });

    it("allows remote origin targeting WSL (WSL is not the local connection)", () => {
        expect(shouldAllowRemoteLocalControl("host1", "wsl://Ubuntu", false)).toBe(true);
    });
});

describe("originConnFromRpcSource", () => {
    it("strips conn: for remote wsh routing", () => {
        expect(originConnFromRpcSource("conn:prod")).toBe("prod");
        expect(originConnFromRpcSource("conn:user@host:22")).toBe("user@host:22");
    });

    it("treats non-conn sources as local", () => {
        expect(originConnFromRpcSource("")).toBe("");
        expect(originConnFromRpcSource(null)).toBe("");
        expect(originConnFromRpcSource(undefined)).toBe("");
        expect(originConnFromRpcSource("electron")).toBe("");
        expect(originConnFromRpcSource("tab:abc")).toBe("");
        expect(originConnFromRpcSource("controller:xyz")).toBe("");
    });
});

describe("assertWebAgentControlDecision", () => {
    it("rejects when browser control is off", () => {
        expect(() =>
            assertWebAgentControlDecision({
                allowBrowserControl: false,
                allowRemoteLocalControl: true,
                originConn: "",
            })
        ).toThrow(ERR_BROWSER_CONTROL_DISABLED);
    });

    it("rejects remote×local when allowremotelocalcontrol is off", () => {
        expect(() =>
            assertWebAgentControlDecision({
                allowBrowserControl: true,
                allowRemoteLocalControl: false,
                originConn: "prod",
                targetConn: "",
            })
        ).toThrow(ERR_REMOTE_TO_LOCAL_DISABLED);
    });

    it("allows local origin when browser control is on", () => {
        expect(() =>
            assertWebAgentControlDecision({
                allowBrowserControl: true,
                allowRemoteLocalControl: false,
                originConn: "",
            })
        ).not.toThrow();
    });

    it("allows WSL origin without allowremotelocalcontrol", () => {
        expect(() =>
            assertWebAgentControlDecision({
                allowBrowserControl: true,
                allowRemoteLocalControl: false,
                originConn: "wsl://Ubuntu",
            })
        ).not.toThrow();
    });

    it("allows remote origin when both gates are on", () => {
        expect(() =>
            assertWebAgentControlDecision({
                allowBrowserControl: true,
                allowRemoteLocalControl: true,
                originConn: "prod",
            })
        ).not.toThrow();
    });

    it("checks browser control before remote-to-local", () => {
        expect(() =>
            assertWebAgentControlDecision({
                allowBrowserControl: false,
                allowRemoteLocalControl: false,
                originConn: "prod",
            })
        ).toThrow(ERR_BROWSER_CONTROL_DISABLED);
    });
});

describe("parseRef", () => {
    it("accepts @N and bare N", () => {
        expect(parseRef("@1")).toBe(1);
        expect(parseRef("1")).toBe(1);
        expect(parseRef("@21")).toBe(21);
        expect(parseRef("  @3  ")).toBe(3);
    });

    it("rejects invalid refs", () => {
        expect(() => parseRef("")).toThrow(/invalid ref/);
        expect(() => parseRef("@")).toThrow(/invalid ref/);
        expect(() => parseRef("foo")).toThrow(/invalid ref/);
        expect(() => parseRef("@1.5")).toThrow(/invalid ref/);
        expect(() => parseRef("@-1")).toThrow(/invalid ref/);
        expect(() => parseRef("0")).toThrow(/invalid ref/);
        expect(() => parseRef("@0")).toThrow(/invalid ref/);
        expect(() => parseRef("@1a")).toThrow(/invalid ref/);
    });
});

describe("formatAxSnapshot", () => {
    it("prints the spec example with @N on interactive roles", () => {
        const nodes: AxNode[] = [
            node({
                nodeId: "root",
                role: { type: "role", value: "RootWebArea" },
                name: { type: "string", value: "Example Domain" },
                childIds: ["h", "p", "a"],
            }),
            node({
                nodeId: "h",
                parentId: "root",
                role: { type: "role", value: "heading" },
                name: { type: "string", value: "Example Domain" },
            }),
            node({
                nodeId: "p",
                parentId: "root",
                role: { type: "role", value: "StaticText" },
                name: {
                    type: "string",
                    value: "This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission.",
                },
            }),
            node({
                nodeId: "a",
                parentId: "root",
                role: { type: "role", value: "link" },
                name: { type: "string", value: "More information..." },
                backendDOMNodeId: 42,
            }),
        ];
        const got = formatAxSnapshot({
            nodes,
            url: "https://example.com/",
            title: "Example Domain",
        });
        expect(got.truncated).toBe(false);
        expect(got.text).toBe(
            [
                "url: https://example.com/",
                "title: Example Domain",
                '- heading "Example Domain"',
                '- StaticText "This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission."',
                '@1 link "More information..."',
                "",
            ].join("\n")
        );
        expect(got.refs).toEqual([{ n: 1, backendDOMNodeId: 42 }]);
    });

    it("skips ignored nodes but still walks their children", () => {
        const nodes: AxNode[] = [
            node({
                nodeId: "root",
                ignored: true,
                childIds: ["btn"],
            }),
            node({
                nodeId: "btn",
                parentId: "root",
                role: { type: "role", value: "button" },
                name: { type: "string", value: "Go" },
                backendDOMNodeId: 7,
            }),
        ];
        const got = formatAxSnapshot({ nodes, url: "u", title: "t" });
        expect(got.text).toContain('@1 button "Go"');
        expect(got.text).not.toContain("ignored");
        expect(got.refs).toEqual([{ n: 1, backendDOMNodeId: 7 }]);
    });

    it("skips unnamed non-interactive nodes", () => {
        const nodes: AxNode[] = [
            node({
                nodeId: "root",
                role: { type: "role", value: "generic" },
                childIds: ["txt"],
            }),
            node({
                nodeId: "txt",
                parentId: "root",
                role: { type: "role", value: "generic" },
            }),
        ];
        const got = formatAxSnapshot({ nodes, url: "u", title: "t" });
        expect(got.text).toBe("url: u\ntitle: t\n");
        expect(got.refs).toEqual([]);
    });

    it("assigns @N in tree order and includes non-empty values", () => {
        const nodes: AxNode[] = [
            node({
                nodeId: "root",
                childIds: ["a", "b"],
            }),
            node({
                nodeId: "a",
                parentId: "root",
                role: { type: "role", value: "BUTTON" },
                name: { type: "string", value: "One" },
                backendDOMNodeId: 1,
            }),
            node({
                nodeId: "b",
                parentId: "root",
                role: { type: "role", value: "textbox" },
                name: { type: "string", value: "Email" },
                value: { type: "string", value: "hi" },
                backendDOMNodeId: 2,
            }),
        ];
        const got = formatAxSnapshot({ nodes, url: "", title: "" });
        expect(got.text).toContain('@1 BUTTON "One"');
        expect(got.text).toContain('@2 textbox "Email" value="hi"');
        expect(got.refs.map((r) => r.n)).toEqual([1, 2]);
    });

    it("does not emit value= when the AX value is empty", () => {
        const nodes: AxNode[] = [
            node({
                nodeId: "root",
                childIds: ["t"],
            }),
            node({
                nodeId: "t",
                parentId: "root",
                role: { type: "role", value: "textbox" },
                name: { type: "string", value: "q" },
                value: { type: "string", value: "" },
                backendDOMNodeId: 3,
            }),
        ];
        const got = formatAxSnapshot({ nodes, url: "u", title: "t" });
        expect(got.text).toContain('@1 textbox "q"\n');
        expect(got.text).not.toContain("value=");
    });

    it("starts from the first node when every node has a parentId", () => {
        const nodes: AxNode[] = [
            node({
                nodeId: "only",
                parentId: "missing",
                role: { type: "role", value: "link" },
                name: { type: "string", value: "x" },
                backendDOMNodeId: 9,
            }),
        ];
        const got = formatAxSnapshot({ nodes, url: "u", title: "t" });
        expect(got.text).toContain('@1 link "x"');
    });

    it("truncates at 800 lines", () => {
        const childIds: string[] = [];
        const nodes: AxNode[] = [node({ nodeId: "root", childIds })];
        for (let i = 0; i < 900; i++) {
            const id = `n${i}`;
            childIds.push(id);
            nodes.push(
                node({
                    nodeId: id,
                    parentId: "root",
                    role: { type: "role", value: "heading" },
                    name: { type: "string", value: `h${i}` },
                })
            );
        }
        const got = formatAxSnapshot({ nodes, url: "u", title: "t" });
        expect(got.truncated).toBe(true);
        const lineCount = got.text.split("\n").filter((l) => l !== "").length;
        expect(lineCount).toBeLessThanOrEqual(SNAPSHOT_MAX_LINES);
        expect(lineCount).toBe(SNAPSHOT_MAX_LINES);
    });

    it("truncates at 64 KiB", () => {
        const name = "x".repeat(2000);
        const childIds: string[] = [];
        const nodes: AxNode[] = [node({ nodeId: "root", childIds })];
        for (let i = 0; i < 80; i++) {
            const id = `n${i}`;
            childIds.push(id);
            nodes.push(
                node({
                    nodeId: id,
                    parentId: "root",
                    role: { type: "role", value: "heading" },
                    name: { type: "string", value: name },
                })
            );
        }
        const got = formatAxSnapshot({ nodes, url: "u", title: "t" });
        expect(got.truncated).toBe(true);
        expect(Buffer.byteLength(got.text, "utf8")).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
    });
});

describe("axValue", () => {
    it("reads CDP { type, value } objects", () => {
        expect(axValue({ type: "role", value: "button" })).toBe("button");
        expect(axValue({ type: "string", value: 3 })).toBe("3");
        expect(axValue(undefined)).toBe("");
        expect(axValue({ type: "string" })).toBe("");
    });
});

describe("click helpers", () => {
    it("computes the content quad center", () => {
        expect(contentQuadCenter([0, 0, 10, 0, 10, 10, 0, 10])).toEqual({ x: 5, y: 5 });
        expect(contentQuadCenter([10, 20, 30, 20, 30, 40, 10, 40])).toEqual({ x: 20, y: 30 });
    });

    it("rejects short, degenerate, and zero-area quads", () => {
        expect(() => contentQuadCenter([1, 2, 3])).toThrow(/invalid box model/);
        expect(() => contentQuadCenter([0, 0, 0, 0, 0, 0, 0, 0])).toThrow(/degenerate/);
        expect(() => contentQuadCenter([5, 5, 5, 5, 5, 5, 5, 5])).toThrow(/degenerate/);
        expect(() => contentQuadCenter([0, 0, 10, 0, 10, 0, 0, 0])).toThrow(/degenerate/);
    });

    it("rejects zero-area client rects", () => {
        expect(() => clientRectCenter({ x: 0, y: 0, width: 0, height: 10 })).toThrow(/zero-area/);
        expect(clientRectCenter({ x: 10, y: 20, width: 20, height: 10 })).toEqual({ x: 20, y: 25 });
    });

    it("detects [x,y] click points", () => {
        expect(isClickPoint([10, 20])).toBe(true);
        expect(isClickPoint([10, 20, 30])).toBe(true);
        expect(isClickPoint("10")).toBe(false);
        expect(isClickPoint([10])).toBe(false);
        expect(isClickPoint(["10", "20"])).toBe(false);
        expect(isClickPoint([NaN, 1])).toBe(false);
    });

    it("uses Meta+a on darwin and Control+a elsewhere", () => {
        expect(selectAllModifier("darwin")).toBe("Meta");
        expect(selectAllModifier("linux")).toBe("Control");
        expect(selectAllModifier("win32")).toBe("Control");
        expect(selectAllKeyModifiers("darwin")).toBe(4);
        expect(selectAllKeyModifiers("linux")).toBe(2);
    });
});

describe("script size, sleep cap, json truncate", () => {
    it("exports the 256 KiB script limit", () => {
        expect(WEB_RUN_MAX_SCRIPT_BYTES).toBe(256 * 1024);
    });

    it("rejects an oversized script", () => {
        const script = "a".repeat(WEB_RUN_MAX_SCRIPT_BYTES + 1);
        expect(() => checkScriptSize(script)).toThrow(/max size/);
        expect(() => checkScriptSize("ok")).not.toThrow();
    });

    it("caps sleep at 30s", () => {
        expect(SLEEP_CAP_MS).toBe(30_000);
        expect(capSleepMs(1000)).toBe(1000);
        expect(capSleepMs(60_000)).toBe(30_000);
        expect(capSleepMs(-5)).toBe(0);
        expect(capSleepMs(NaN)).toBe(0);
    });

    it("truncates json at 1 MiB", () => {
        expect(JS_RESULT_MAX_BYTES).toBe(1024 * 1024);
        const small = truncateJsonValue({ a: 1 });
        expect(small.truncated).toBe(false);
        expect(small.value).toEqual({ a: 1 });
        const big = truncateJsonValue("x".repeat(JS_RESULT_MAX_BYTES), 100);
        expect(big.truncated).toBe(true);
        expect(big.value).toEqual({ truncated: true, bytes: expect.any(Number) });
    });

    it("stringifies print args", () => {
        expect(stringifyPrintArg("hi")).toBe("hi");
        expect(stringifyPrintArg(2)).toBe("2");
        expect(stringifyPrintArg(undefined)).toBe("undefined");
        expect(stringifyPrintArg({ a: 1 })).toBe('{"a":1}');
    });
});

describe("guest webcontents id", () => {
    it("rejects empty, NaN, and non-positive ids so lookup can retry", () => {
        expect(isUsableWebContentsId(null)).toBe(false);
        expect(isUsableWebContentsId(undefined)).toBe(false);
        expect(isUsableWebContentsId("")).toBe(false);
        expect(isUsableWebContentsId("abc")).toBe(false);
        expect(isUsableWebContentsId(0)).toBe(false);
        expect(isUsableWebContentsId(-1)).toBe(false);
        expect(isUsableWebContentsId("12")).toBe(true);
        expect(isUsableWebContentsId(12)).toBe(true);
    });
});

describe("secret call scan", () => {
    it("detects secret( in scripts and ignores other identifiers", () => {
        expect(scriptContainsSecretCall(`await fill("@1", secret("site_password"));`)).toBe(true);
        expect(scriptContainsSecretCall(`const x = secret ("a")`)).toBe(true);
        expect(scriptContainsSecretCall(`await snapshot(); await click("@1");`)).toBe(false);
        expect(scriptContainsSecretCall(`const secretName = "x";`)).toBe(false);
    });
});

describe("type chunks", () => {
    it("turns newlines and tabs into key events", () => {
        expect(splitTypeChunks("hi\n")).toEqual([
            { kind: "text", text: "hi" },
            { kind: "key", key: "Enter", code: "Enter", keyCode: 13 },
        ]);
        expect(splitTypeChunks("a\tb")).toEqual([
            { kind: "text", text: "a" },
            { kind: "key", key: "Tab", code: "Tab", keyCode: 9 },
            { kind: "text", text: "b" },
        ]);
        expect(splitTypeChunks("\r\n")).toEqual([{ kind: "key", key: "Enter", code: "Enter", keyCode: 13 }]);
    });
});

describe("abortable send", () => {
    it("refuses commands after abort", async () => {
        let calls = 0;
        const inner = async () => {
            calls += 1;
            return "ok";
        };
        const gate = createAbortableSend(inner);
        await expect(gate.send("Page.enable")).resolves.toBe("ok");
        gate.abort();
        await expect(gate.send("Page.navigate")).rejects.toThrow(ERR_WEB_RUN_ABORTED);
        expect(calls).toBe(1);
        expect(gate.isAborted()).toBe(true);
    });
});

describe("navigate wait", () => {
    function base(overrides: Partial<NavigateWaitState> = {}): NavigateWaitState {
        return {
            requestedUrl: "https://example.com/next",
            urlBeforeNavigate: "https://example.com/",
            seenLoaderLoads: [],
            loadForLoader: false,
            mainFrameNavigated: false,
            currentUrl: "https://example.com/",
            readyState: "complete",
            elapsedMs: 300,
            loaderId: "L1",
            ...overrides,
        };
    }

    it("does not complete just because the previous document is already complete", () => {
        expect(shouldCompleteNavigate(base())).toBe(false);
    });

    it("completes when this navigation's loader fires load", () => {
        expect(shouldCompleteNavigate(base({ loadForLoader: true }))).toBe(true);
    });

    it("does not treat Page.loadEventFired as this navigation's load", () => {
        const state = base();
        applyNavigateCdpEvent(state, "Page.frameNavigated", { frame: { id: "main" } }, "main");
        applyNavigateCdpEvent(state, "Page.loadEventFired", {});
        expect(state.loadForLoader).toBe(false);
        expect(shouldCompleteNavigate(state)).toBe(false);
    });

    it("completes when the main frame navigated to the requested URL", () => {
        expect(
            shouldCompleteNavigate(
                base({
                    mainFrameNavigated: true,
                    currentUrl: "https://example.com/next",
                    readyState: "complete",
                })
            )
        ).toBe(true);
    });

    it("ignores iframe frameNavigated", () => {
        const state = base();
        applyNavigateCdpEvent(
            state,
            "Page.frameNavigated",
            {
                frame: { id: "iframe", parentId: "main", url: "https://ads.example/" },
            },
            "main"
        );
        expect(state.mainFrameNavigated).toBe(false);
        applyNavigateCdpEvent(
            state,
            "Page.frameNavigated",
            {
                frame: { id: "main", url: "https://example.com/next" },
            },
            "main"
        );
        expect(state.mainFrameNavigated).toBe(true);
    });

    it("matches loaderId lifecycle and ignores other loaders", () => {
        const state = base({ loaderId: "L1" });
        applyNavigateCdpEvent(state, "Page.lifecycleEvent", { name: "load", loaderId: "other" });
        expect(state.loadForLoader).toBe(false);
        applyNavigateCdpEvent(state, "Page.lifecycleEvent", { name: "load", loaderId: "L1" });
        expect(state.loadForLoader).toBe(true);
    });

    it("counts lifecycle events that arrive before loaderId is assigned", () => {
        const state = emptyNavigateWaitState("https://example.com/next", "https://example.com/");
        applyNavigateCdpEvent(state, "Page.lifecycleEvent", { name: "load", loaderId: "L9" });
        expect(state.loadForLoader).toBe(false);
        assignNavigateLoaderId(state, "L9");
        expect(state.loadForLoader).toBe(true);
        expect(shouldCompleteNavigate(state)).toBe(true);
    });

    it("treats hash navigation as complete without a new loader load", () => {
        expect(
            shouldCompleteNavigate(
                base({
                    requestedUrl: "https://example.com/#section",
                    urlBeforeNavigate: "https://example.com/",
                    currentUrl: "https://example.com/#section",
                    loaderId: undefined,
                    mainFrameNavigated: false,
                    readyState: "complete",
                    elapsedMs: 120,
                })
            )
        ).toBe(true);
    });

    it("does not treat a hash-URL reload as complete before the new load", () => {
        expect(
            shouldCompleteNavigate(
                base({
                    requestedUrl: "https://example.com/#section",
                    urlBeforeNavigate: "https://example.com/#section",
                    currentUrl: "https://example.com/#section",
                    loaderId: "L2",
                    mainFrameNavigated: false,
                    readyState: "complete",
                    elapsedMs: 300,
                })
            )
        ).toBe(false);
    });

    it("does not treat a same-URL reload as complete before the new load", () => {
        expect(
            shouldCompleteNavigate(
                base({
                    requestedUrl: "https://example.com/",
                    urlBeforeNavigate: "https://example.com/",
                    currentUrl: "https://example.com/",
                    loaderId: "L2",
                    mainFrameNavigated: false,
                    readyState: "complete",
                    elapsedMs: 300,
                })
            )
        ).toBe(false);
    });

    it("matches trailing slashes on the path", () => {
        expect(urlsMatchForNavigate("https://example.com/foo", "https://example.com/foo/")).toBe(true);
        expect(urlsMatchForNavigate("https://example.com/a", "https://example.com/b")).toBe(false);
    });

    it("skips Page.navigate when already at the URL and complete", () => {
        expect(pageNavigateStrategy("https://example.com/", "https://example.com/", "complete")).toBe("skip");
        expect(pageNavigateStrategy("https://example.com/", "https://example.com/", "loading")).toBe("wait-inflight");
        expect(pageNavigateStrategy("https://b.example/", "https://example.com/", "complete")).toBe("navigate");
    });

    it("detects ERR_ABORTED from in-flight widget loads", () => {
        expect(isNavigateAbortedError("net::ERR_ABORTED")).toBe(true);
        expect(isNavigateAbortedError("net::ERR_NAME_NOT_RESOLVED")).toBe(false);
    });
});

describe("ref errors", () => {
    it("distinguishes missing snapshot from ARIA-only nodes", () => {
        expect(staleRefError(3).message).toMatch(/stale ref @3/);
        expect(missingBackendNodeError(3).message).toMatch(/no backend DOM node/);
    });
});
