// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CssNode, List, ListItem } from "css-tree";
import * as csstree from "css-tree";

function validateAndWrapCss(cssText: string, wrapperClassName: string) {
    try {
        const ast = csstree.parse(cssText);
        csstree.walk(ast, {
            enter(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
                // Remove disallowed @rules
                const blockedRules = ["import", "font-face", "keyframes", "namespace", "supports"];
                if (node.type === "Atrule" && blockedRules.includes(node.name)) {
                    list.remove(item);
                }
                // Remove :root selectors
                if (
                    node.type === "Selector" &&
                    node.children.some((child) => child.type === "PseudoClassSelector" && child.name === "root")
                ) {
                    list.remove(item);
                }
            },
        });
        const sanitizedCss = csstree.generate(ast);
        return `${wrapperClassName} { ${sanitizedCss} }`;
    } catch (error) {
        console.error("CSS processing error:", error);
        return null;
    }
}

export { validateAndWrapCss };
