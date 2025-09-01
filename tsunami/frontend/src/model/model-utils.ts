// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

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
