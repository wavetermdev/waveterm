// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/global";
import { VDomModel } from "@/app/view/term/vdom-model";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import * as jotai from "jotai";
import * as React from "react";

const TextTag = "#text";
const FragmentTag = "#fragment";
const WaveTextTag = "wave:text";

const AllowedTags: { [tagName: string]: boolean } = {
    div: true,
    b: true,
    i: true,
    p: true,
    s: true,
    span: true,
    a: true,
    img: true,
    h1: true,
    h2: true,
    h3: true,
    h4: true,
    h5: true,
    h6: true,
    ul: true,
    ol: true,
    li: true,
    input: true,
    button: true,
    textarea: true,
    select: true,
    option: true,
    form: true,
};

function convertVDomFunc(fnDecl: VDomFunc, compId: string, propName: string): (e: any) => void {
    return (e: any) => {
        if ((propName == "onKeyDown" || propName == "onKeyDownCapture") && fnDecl["#keys"]) {
            let waveEvent = adaptFromReactOrNativeKeyEvent(e);
            for (let keyDesc of fnDecl["#keys"]) {
                if (checkKeyPressed(waveEvent, keyDesc)) {
                    e.preventDefault();
                    e.stopPropagation();
                    callFunc(e, compId, propName);
                    return;
                }
            }
            return;
        }
        if (fnDecl["#preventDefault"]) {
            e.preventDefault();
        }
        if (fnDecl["#stopPropagation"]) {
            e.stopPropagation();
        }
        callFunc(e, compId, propName);
    };
}

function convertElemToTag(elem: VDomElem): JSX.Element | string {
    if (elem == null) {
        return null;
    }
    if (elem.tag == TextTag) {
        return elem.text;
    }
    return React.createElement(VDomTag, { elem: elem, key: elem.waveid });
}

function isObject(v: any): boolean {
    return v != null && !Array.isArray(v) && typeof v === "object";
}

function isArray(v: any): boolean {
    return Array.isArray(v);
}

function callFunc(e: any, compId: string, propName: string) {
    console.log("callfunc", compId, propName);
}

function updateRefFunc(elem: any, ref: VDomRef) {
    console.log("updateref", ref["#ref"], elem);
}

function VDomTag({ elem }: { elem: VDomElem }) {
    if (!AllowedTags[elem.tag]) {
        return <div>{"Invalid Tag <" + elem.tag + ">"}</div>;
    }
    let props = {};
    for (let key in elem.props) {
        let val = elem.props[key];
        if (val == null) {
            continue;
        }
        if (key == "ref") {
            if (val == null) {
                continue;
            }
            if (isObject(val) && "#ref" in val) {
                props[key] = (elem: HTMLElement) => {
                    updateRefFunc(elem, val);
                };
            }
            continue;
        }
        if (isObject(val) && "#func" in val) {
            props[key] = convertVDomFunc(val, elem.waveid, key);
            continue;
        }
    }
    let childrenComps: (string | JSX.Element)[] = [];
    if (elem.children) {
        for (let child of elem.children) {
            if (child == null) {
                continue;
            }
            childrenComps.push(convertElemToTag(child));
        }
    }
    if (elem.tag == FragmentTag) {
        return childrenComps;
    }
    return React.createElement(elem.tag, props, childrenComps);
}

function vdomText(text: string): VDomElem {
    return {
        tag: "#text",
        text: text,
    };
}

const testVDom: VDomElem = {
    waveid: "testid1",
    tag: "div",
    children: [
        {
            waveid: "testh1",
            tag: "h1",
            children: [vdomText("Hello World")],
        },
        {
            waveid: "testp",
            tag: "p",
            children: [vdomText("This is a paragraph (from VDOM)")],
        },
    ],
};

function VDomView({ blockId }: { blockId: string }) {
    let [model, setModel] = React.useState<VDomModel>(null);
    React.useEffect(() => {
        const model = new VDomModel(blockId);
        globalStore.set(model.vdomRoot, testVDom);
        setModel(model);
    }, []);
    if (!model) {
        return null;
    }
    let rootNode = jotai.useAtomValue(model.vdomRoot);
    let rtn = convertElemToTag(rootNode);
    return <div className="vdom">{rtn}</div>;
}

export { VDomView };
