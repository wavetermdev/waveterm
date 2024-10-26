// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { VDomModel } from "@/app/view/vdom/vdom-model";
import type { CssNode, List, ListItem } from "css-tree";
import * as csstree from "css-tree";

const TextTag = "#text";

// TODO support binding
export function getTextChildren(elem: VDomElem): string {
    if (elem.tag == TextTag) {
        return elem.text;
    }
    if (!elem.children) {
        return null;
    }
    const textArr = elem.children.map((child) => {
        return getTextChildren(child);
    });
    return textArr.join("");
}

export function convertVDomId(model: VDomModel, id: string): string {
    return model.blockId + "::" + id;
}

export function validateAndWrapCss(model: VDomModel, cssText: string, wrapperClassName: string) {
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

                if (node.type === "IdSelector") {
                    node.name = convertVDomId(model, node.name);
                }
            },
        });
        const sanitizedCss = csstree.generate(ast);
        return `.${wrapperClassName} { ${sanitizedCss} }`;
    } catch (error) {
        // TODO better error handling
        console.error("CSS processing error:", error);
        return null;
    }
}
