// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Code, Content, Html, Root } from "mdast";
import type { Plugin } from "unified";
import type { Parent } from "unist";
import { SKIP, visit } from "unist-util-visit";
import type { VFile } from "vfile";

const escapeHTML = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const remarkMermaidToTag: Plugin<[], Root> = function () {
    return (tree: Root, _file: VFile) => {
        visit(tree, "code", (node: Code, index: number | null, parent: Parent | null) => {
            if (!parent || index === null) return;
            if ((node.lang ?? "").toLowerCase() !== "mermaid") return;

            const htmlNode: Html = {
                type: "html",
                value: `<mermaidblock>${escapeHTML(node.value ?? "")}</mermaidblock>`,
            };

            (parent.children as Content[])[index] = htmlNode as Content;
            return SKIP;
        });
    };
};

export default remarkMermaidToTag;
