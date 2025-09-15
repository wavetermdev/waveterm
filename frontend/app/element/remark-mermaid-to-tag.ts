// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { visit } from "unist-util-visit";

const escapeHTML = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export default function remarkMermaidToTag() {
    return (tree: any) => {
        visit(tree, "code", (node: any, index: number, parent: any) => {
            if (!parent || typeof index !== "number") return;
            if ((node.lang || "").toLowerCase() !== "mermaid") return;

            parent.children[index] = {
                type: "html",
                value: `<mermaidblock>${escapeHTML(node.value || "")}</mermaidblock>`,
            };
        });
    };
}
