// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { openLink } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom } from "jotai";
import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./preview-markdown";

const { renderedLinks } = vi.hoisted(() => ({ renderedLinks: [] as React.ReactElement<any>[] }));

vi.mock("@/app/store/global", () => ({
    openLink: vi.fn(),
    getOverrideConfigAtom: () => atom(null),
}));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { FileJoinCommand: vi.fn() } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));
vi.mock("overlayscrollbars-react", () => ({
    OverlayScrollbarsComponent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/app/element/markdown-link", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/app/element/markdown-link")>();
    return {
        MarkdownLink: (props: Parameters<typeof actual.MarkdownLink>[0]) => {
            const anchor = actual.MarkdownLink(props);
            renderedLinks.push(anchor);
            return anchor;
        },
    };
});

function renderPreview(text: string, connName: string = null, filePath = "C:/docs/start.md", dir = "C:/docs") {
    const connection = atom(connName);
    const model = {
        blockId: "markdown-preview-test",
        // Supply the already-resolved connection value for server rendering.
        connection,
        connectionImmediate: connection,
        metaFilePath: atom(filePath),
        statFile: atom({ path: filePath, dir } as FileInfo),
        fileContent: atom(text),
        markdownShowToc: atom(false),
        refreshVersion: atom(0),
        goHistory: vi.fn(async (_path: string) => {}),
    };
    const markup = renderToStaticMarkup(<MarkdownPreview model={model as any} parentRef={{ current: null }} />);
    expect(renderedLinks).toHaveLength(1);
    const anchor = renderedLinks[0];
    const event = { preventDefault: vi.fn() } as unknown as React.MouseEvent;
    return { model, markup, anchor, event, click: () => anchor.props.onClick(event) };
}

describe("Markdown preview link wiring", () => {
    beforeEach(() => {
        renderedLinks.length = 0;
        vi.clearAllMocks();
        vi.mocked(RpcApi.FileJoinCommand).mockResolvedValue({ path: "C:/docs/target.md" } as FileInfo);
    });

    it("navigates a parsed file link using the displayed document directory", async () => {
        const { click, event, model } = renderPreview("[Target](target.md)");
        await click();
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(RpcApi.FileJoinCommand).toHaveBeenCalledExactlyOnceWith(TabRpcClient, [
            "wsh://local/C:/docs",
            "target.md",
        ]);
        expect(model.goHistory).toHaveBeenCalledExactlyOnceWith("C:/docs/target.md");
        expect(globalStore.get(model.connection)).toBeNull();
        expect(openLink).not.toHaveBeenCalled();
    });

    it("keeps remote file navigation on the document connection", async () => {
        vi.mocked(RpcApi.FileJoinCommand).mockResolvedValue({ path: "/docs/target.md" } as FileInfo);
        const { click, model } = renderPreview("[Target](target.md)", "example-host", "/docs/start.md", "/docs");
        await click();
        expect(RpcApi.FileJoinCommand).toHaveBeenCalledExactlyOnceWith(TabRpcClient, [
            "wsh://example-host//docs",
            "target.md",
        ]);
        expect(model.goHistory).toHaveBeenCalledExactlyOnceWith("/docs/target.md");
        expect(globalStore.get(model.connection)).toBe("example-host");
        expect(openLink).not.toHaveBeenCalled();
    });

    it.each([
        ["../Other%20Notes.md", "../Other Notes.md"],
        ["notes%23draft%3F.md", "notes#draft?.md"],
        ["notes%.md", "notes%.md"],
        ["日記.md", "日記.md"],
    ])("resolves %s after real Markdown parsing and sanitization", async (href, path) => {
        const { click, model } = renderPreview(`[Target](${href})`);
        await click();
        expect(RpcApi.FileJoinCommand).toHaveBeenCalledExactlyOnceWith(TabRpcClient, ["wsh://local/C:/docs", path]);
        expect(model.goHistory).toHaveBeenCalledOnce();
        expect(openLink).not.toHaveBeenCalled();
    });

    it("preserves HTTPS dispatch through the real parser", async () => {
        const { click, model } = renderPreview("[Web](https://example.com/path#section)");
        await click();
        expect(openLink).toHaveBeenCalledExactlyOnceWith("https://example.com/path#section");
        expect(RpcApi.FileJoinCommand).not.toHaveBeenCalled();
        expect(model.goHistory).not.toHaveBeenCalled();
    });

    it.each(["[Unsafe](javascript:alert%281%29)", '<a href="javascript:alert(1)">Unsafe</a>'])(
        "does not dispatch links rejected by the existing parser/sanitizer: %s",
        async (text) => {
            const { click, model, anchor } = renderPreview(text);
            expect(anchor.props.href ?? "").toBe("");
            await click();
            expect(RpcApi.FileJoinCommand).not.toHaveBeenCalled();
            expect(model.goHistory).not.toHaveBeenCalled();
            expect(openLink).not.toHaveBeenCalled();
        }
    );

    it.each(["connection", "document"])("ignores delayed resolution after changing the %s", async (change) => {
        let complete: (fileInfo: FileInfo) => void;
        vi.mocked(RpcApi.FileJoinCommand).mockImplementationOnce(
            () => new Promise<FileInfo>((resolve) => (complete = resolve))
        );
        const { click, model } = renderPreview("[Target](target.md)", "host-A", "/docs/start.md", "/docs");
        const pendingClick = click();
        expect(RpcApi.FileJoinCommand).toHaveBeenCalledExactlyOnceWith(TabRpcClient, [
            "wsh://host-A//docs",
            "target.md",
        ]);
        if (change === "connection") {
            globalStore.set(model.connection, "host-B");
        } else {
            globalStore.set(model.metaFilePath, "/other/new.md");
        }
        complete({ path: "/docs/target.md" } as FileInfo);
        await pendingClick;
        expect(model.goHistory).not.toHaveBeenCalled();
        expect(openLink).not.toHaveBeenCalled();
        expect(globalStore.get(model.connection)).toBe(change === "connection" ? "host-B" : "host-A");
        expect(globalStore.get(model.metaFilePath)).toBe(change === "document" ? "/other/new.md" : "/docs/start.md");
    });
});
