// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { CssNode, List, ListItem } from "css-tree";
import * as csstree from "css-tree";
import type { TsunamiModel } from "./tsunami-model";

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

export function convertVDomId(model: TsunamiModel, id: string): string {
    return model.blockId + "::" + id;
}

export function validateAndWrapCss(model: TsunamiModel, cssText: string, wrapperClassName: string) {
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

                // Transform url(#id) references in filter and mask properties (svg)
                if (node.type === "Declaration" && ["filter", "mask"].includes(node.property)) {
                    if (node.value && node.value.type === "Value" && "children" in node.value) {
                        const urlNode = node.value.children
                            .toArray()
                            .find(
                                (child: CssNode): child is CssNode & { value: string } =>
                                    child && child.type === "Url" && typeof (child as any).value === "string"
                            );
                        if (urlNode && urlNode.value && urlNode.value.startsWith("#")) {
                            urlNode.value = "#" + convertVDomId(model, urlNode.value.substring(1));
                        }
                    }
                }
                // transform url(vdom:///foo.jpg)
                if (node.type === "Url" && node.value != null && node.value.startsWith("vdom://")) {
                    const newUrl = model.transformVDomUrl(node.value);
                    if (newUrl == null) {
                        list.remove(item);
                    } else {
                        node.value = newUrl;
                    }
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

function cssTransformStyleValue(model: TsunamiModel, property: string, value: string): string {
    try {
        const ast = csstree.parse(value, { context: "value" });
        csstree.walk(ast, {
            enter(node: CssNode, item: ListItem<CssNode>, list: List<CssNode>) {
                // Transform url(#id) in filter/mask properties
                if (node.type === "Url" && (property === "filter" || property === "mask")) {
                    if (node.value.startsWith("#")) {
                        node.value = `#${convertVDomId(model, node.value.substring(1))}`;
                    }
                }
                // transform vdom:// urls
                if (node.type === "Url" && node.value != null && node.value.startsWith("vdom://")) {
                    const newUrl = model.transformVDomUrl(node.value);
                    if (newUrl == null) {
                        list.remove(item);
                    } else {
                        node.value = newUrl;
                    }
                }
            },
        });

        return csstree.generate(ast);
    } catch (error) {
        console.error("Error processing style value:", error);
        return value;
    }
}

export function validateAndWrapReactStyle(model: TsunamiModel, style: Record<string, any>): Record<string, any> {
    const sanitizedStyle: Record<string, any> = {};
    let updated = false;
    for (const [property, value] of Object.entries(style)) {
        if (value == null || value === "") {
            continue;
        }
        if (typeof value !== "string") {
            sanitizedStyle[property] = value; // For non-string values, just copy as-is
            continue;
        }
        if (value.includes("vdom://") || value.includes("url(#")) {
            updated = true;
            sanitizedStyle[property] = cssTransformStyleValue(model, property, value);
        } else {
            sanitizedStyle[property] = value;
        }
    }
    if (!updated) {
        return style;
    }
    return sanitizedStyle;
}

export function restoreVDomElems(backendUpdate: VDomBackendUpdate) {
    if (!backendUpdate.transferelems || !backendUpdate.renderupdates) {
        return;
    }

    // Step 1: Map of waveid to VDomElem, skipping any without a waveid
    const elemMap = new Map<string, VDomElem>();
    backendUpdate.transferelems.forEach((transferElem) => {
        if (!transferElem.waveid) {
            return;
        }
        elemMap.set(transferElem.waveid, {
            waveid: transferElem.waveid,
            tag: transferElem.tag,
            props: transferElem.props,
            children: [], // Will populate children later
            text: transferElem.text,
        });
    });

    // Step 2: Build VDomElem trees by linking children
    backendUpdate.transferelems.forEach((transferElem) => {
        const parent = elemMap.get(transferElem.waveid);
        if (!parent || !transferElem.children || transferElem.children.length === 0) {
            return;
        }
        parent.children = transferElem.children.map((childId) => elemMap.get(childId)).filter((child) => child != null); // Explicit null check
    });

    // Step 3: Update renderupdates with rebuilt VDomElem trees
    backendUpdate.renderupdates.forEach((update) => {
        if (update.vdomwaveid) {
            update.vdom = elemMap.get(update.vdomwaveid);
        }
    });
}

export function mergeBackendUpdates(baseUpdate: VDomBackendUpdate, nextUpdate: VDomBackendUpdate) {
    // Verify the updates are from the same block/sequence
    if (baseUpdate.blockid !== nextUpdate.blockid || baseUpdate.ts !== nextUpdate.ts) {
        console.error("Attempted to merge updates from different blocks or timestamps");
        return;
    }

    // Merge TransferElems
    if (nextUpdate.transferelems?.length > 0) {
        if (!baseUpdate.transferelems) {
            baseUpdate.transferelems = [];
        }
        baseUpdate.transferelems.push(...nextUpdate.transferelems);
    }

    // Merge StateSync
    if (nextUpdate.statesync?.length > 0) {
        if (!baseUpdate.statesync) {
            baseUpdate.statesync = [];
        }
        baseUpdate.statesync.push(...nextUpdate.statesync);
    }
}

export function applyCanvasOp(canvas: HTMLCanvasElement, canvasOp: VDomRefOperation, refStore: Map<string, any>) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        console.error("Canvas 2D context not available.");
        return;
    }

    let { op, params, outputref } = canvasOp;
    if (params == null) {
        params = [];
    }
    if (op == null || op == "") {
        return;
    }
    // Resolve any reference parameters in params
    const resolvedParams: any[] = [];
    params.forEach((param) => {
        if (typeof param === "string" && param.startsWith("#ref:")) {
            const refId = param.slice(5); // Remove "#ref:" prefix
            resolvedParams.push(refStore.get(refId));
        } else if (typeof param === "string" && param.startsWith("#spreadRef:")) {
            const refId = param.slice(11); // Remove "#spreadRef:" prefix
            const arrayRef = refStore.get(refId);
            if (Array.isArray(arrayRef)) {
                resolvedParams.push(...arrayRef); // Spread array elements
            } else {
                console.error(`Reference ${refId} is not an array and cannot be spread.`);
            }
        } else {
            resolvedParams.push(param);
        }
    });

    // Apply the operation on the canvas context
    if (op === "dropRef" && params.length > 0 && typeof params[0] === "string") {
        refStore.delete(params[0]);
    } else if (op === "addRef" && outputref) {
        refStore.set(outputref, resolvedParams[0]);
    } else if (typeof ctx[op as keyof CanvasRenderingContext2D] === "function") {
        (ctx[op as keyof CanvasRenderingContext2D] as Function).apply(ctx, resolvedParams);
    } else if (op in ctx) {
        (ctx as any)[op] = resolvedParams[0];
    } else {
        console.error(`Unsupported canvas operation: ${op}`);
    }
}
