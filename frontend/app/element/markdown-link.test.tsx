// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { openLink } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownLink } from "./markdown-link";

vi.mock("@/app/store/global", () => ({ openLink: vi.fn() }));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: { FileJoinCommand: vi.fn() } }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

const localOpts: MarkdownResolveOpts = { connName: null, baseDir: "C:/docs/examples" };

function makeLink(href: string, resolveOpts = localOpts, onOpenFile = vi.fn(async (_path: string) => {})) {
    const setFocusedHeading = vi.fn();
    const link = MarkdownLink({
        props: { href, children: "Example" },
        resolveOpts,
        onOpenFile,
        setFocusedHeading,
    });
    const event = { preventDefault: vi.fn() } as unknown as React.MouseEvent;
    return {
        link,
        onOpenFile,
        setFocusedHeading,
        event,
        click: () => link.props.onClick(event),
    };
}

describe("Markdown file links", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(RpcApi.FileJoinCommand).mockResolvedValue({ path: "C:/docs/examples/target" } as FileInfo);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([
        { connName: null, baseDir: "C:/docs/examples", baseUri: "wsh://local/C:/docs/examples" },
        { connName: "local", baseDir: "/docs/examples", baseUri: "wsh://local//docs/examples" },
        { connName: "example-host", baseDir: "/docs/examples", baseUri: "wsh://example-host//docs/examples" },
        { connName: "wsl://Ubuntu", baseDir: "/docs/examples", baseUri: "wsh://wsl://Ubuntu//docs/examples" },
    ])(
        "resolves MD/PDF/WAV links on $connName using the document directory",
        async ({ connName, baseDir, baseUri }) => {
            for (const href of ["chapter.md", "diagram.pdf", "sample.wav"]) {
                vi.mocked(RpcApi.FileJoinCommand).mockClear();
                const resolvedPath = `${baseDir}/${href}`;
                vi.mocked(RpcApi.FileJoinCommand).mockResolvedValue({ path: resolvedPath } as FileInfo);
                const { click, event, onOpenFile, setFocusedHeading } = makeLink(href, { connName, baseDir });
                await click();
                expect(event.preventDefault).toHaveBeenCalledOnce();
                expect(RpcApi.FileJoinCommand).toHaveBeenCalledExactlyOnceWith(TabRpcClient, [baseUri, href]);
                expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(resolvedPath);
                expect(openLink).not.toHaveBeenCalled();
                expect(setFocusedHeading).not.toHaveBeenCalled();
            }
        }
    );

    it.each([
        ["../Other%20Notes.md", "../Other Notes.md"],
        ["./subfolder/chapter.md", "./subfolder/chapter.md"],
        ["../../chapter.md", "../../chapter.md"],
        ["folder/", "folder/"],
        ["/docs/chapter.md", "/docs/chapter.md"],
        ["~/chapter.md", "~/chapter.md"],
        ["notes%23draft%3F.md", "notes#draft?.md"],
        ["100%25.md", "100%.md"],
        ["literal%2520space.md", "literal%20space.md"],
        ["%E6%97%A5%E8%A8%98.md", "日記.md"],
        ["chapter.md#section", "chapter.md"],
        ["sample.wav?download=1#t=2", "sample.wav"],
    ])("passes the decoded path for %s to the connection-aware backend", async (href, path) => {
        const { click, onOpenFile } = makeLink(href);
        await click();
        expect(RpcApi.FileJoinCommand).toHaveBeenCalledExactlyOnceWith(TabRpcClient, [
            "wsh://local/C:/docs/examples",
            path,
        ]);
        expect(onOpenFile).toHaveBeenCalledExactlyOnceWith("C:/docs/examples/target");
        expect(openLink).not.toHaveBeenCalled();
    });

    it("preserves same-document heading navigation", async () => {
        const { click, setFocusedHeading, onOpenFile } = makeLink("#section");
        await click();
        expect(setFocusedHeading).toHaveBeenCalledExactlyOnceWith("#section");
        expect(RpcApi.FileJoinCommand).not.toHaveBeenCalled();
        expect(onOpenFile).not.toHaveBeenCalled();
        expect(openLink).not.toHaveBeenCalled();
    });

    it.each([
        "https://example.com/chapter.md#section",
        "HTTP://example.com/",
        "mailto:reader@example.com",
        "tel:+123456789",
        "file:///C:/docs/chapter.md",
        "wsh://example-host/docs/chapter.md",
        "custom+scheme://example/path",
        "//example.com/chapter.md",
    ])("preserves existing external dispatch for %s", async (href) => {
        const { click, onOpenFile, setFocusedHeading } = makeLink(href);
        await click();
        expect(openLink).toHaveBeenCalledExactlyOnceWith(href);
        expect(RpcApi.FileJoinCommand).not.toHaveBeenCalled();
        expect(onOpenFile).not.toHaveBeenCalled();
        expect(setFocusedHeading).not.toHaveBeenCalled();
    });

    it.each([null, undefined, ""])("does not dispatch missing/empty href %s", async (href) => {
        const { click, event, onOpenFile } = makeLink(href);
        await click();
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(openLink).not.toHaveBeenCalled();
        expect(RpcApi.FileJoinCommand).not.toHaveBeenCalled();
        expect(onOpenFile).not.toHaveBeenCalled();
    });

    it("leaves Markdown outside file previews on its existing route", async () => {
        const { click, onOpenFile } = makeLink("chapter.md", null);
        await click();
        expect(openLink).toHaveBeenCalledExactlyOnceWith("chapter.md");
        expect(RpcApi.FileJoinCommand).not.toHaveBeenCalled();
        expect(onOpenFile).not.toHaveBeenCalled();
    });

    it("requires a preview navigation callback before resolving paths", async () => {
        const link = MarkdownLink({
            props: { href: "chapter.md" },
            resolveOpts: localOpts,
            setFocusedHeading: vi.fn(),
        });
        await link.props.onClick({ preventDefault: vi.fn() } as unknown as React.MouseEvent);
        expect(openLink).toHaveBeenCalledExactlyOnceWith("chapter.md");
        expect(RpcApi.FileJoinCommand).not.toHaveBeenCalled();
    });

    it.each(["bad%ZZ.md", "incomplete%.md"])("contains malformed encoding in %s without OS fallback", async (href) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { click, onOpenFile } = makeLink(href);
        await click();
        expect(warn).toHaveBeenCalledOnce();
        expect(RpcApi.FileJoinCommand).not.toHaveBeenCalled();
        expect(onOpenFile).not.toHaveBeenCalled();
        expect(openLink).not.toHaveBeenCalled();
    });

    it("does not treat a query-only destination as a file", async () => {
        const { click, onOpenFile } = makeLink("?download=1");
        await click();
        expect(RpcApi.FileJoinCommand).not.toHaveBeenCalled();
        expect(onOpenFile).not.toHaveBeenCalled();
        expect(openLink).not.toHaveBeenCalled();
    });

    it("contains backend resolution errors without external fallback", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = new Error("connection unavailable");
        vi.mocked(RpcApi.FileJoinCommand).mockRejectedValue(error);
        const { click, onOpenFile } = makeLink("chapter.md");
        await click();
        expect(warn).toHaveBeenCalledExactlyOnceWith("Failed to open Markdown file link:", "chapter.md", error);
        expect(onOpenFile).not.toHaveBeenCalled();
        expect(openLink).not.toHaveBeenCalled();
    });

    it("awaits and contains preview navigation errors", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const error = new Error("navigation unavailable");
        const onOpenFile = vi.fn(async (_path: string) => {
            throw error;
        });
        const { click } = makeLink("chapter.md", localOpts, onOpenFile);
        await click();
        expect(onOpenFile).toHaveBeenCalledOnce();
        expect(warn).toHaveBeenCalledExactlyOnceWith("Failed to open Markdown file link:", "chapter.md", error);
        expect(openLink).not.toHaveBeenCalled();
    });

    it("retains the original href and escapes link text in the rendered anchor", () => {
        const markup = renderToStaticMarkup(
            <MarkdownLink
                props={{ href: "../Other%20Notes.md", children: "<script>Example</script>" }}
                setFocusedHeading={vi.fn()}
            />
        );
        expect(markup).toContain('href="../Other%20Notes.md"');
        expect(markup).toContain("&lt;script&gt;Example&lt;/script&gt;");
        expect(RpcApi.FileJoinCommand).not.toHaveBeenCalled();
        expect(openLink).not.toHaveBeenCalled();
    });
});
