// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { VDomModel } from "@/app/view/term/vdom-model";
import { NodeModel } from "@/layout/index";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import { useAtomValueSafe } from "@/util/util";
import debug from "debug";
import * as jotai from "jotai";
import * as React from "react";

const TextTag = "#text";
const FragmentTag = "#fragment";
const WaveTextTag = "wave:text";
const WaveNullTag = "wave:null";

const VDomObjType_Ref = "ref";
const VDomObjType_Binding = "binding";
const VDomObjType_Func = "func";

const dlog = debug("wave:vdom");

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

function convertVDomFunc(model: VDomModel, fnDecl: VDomFunc, compId: string, propName: string): (e: any) => void {
    return (e: any) => {
        if ((propName == "onKeyDown" || propName == "onKeyDownCapture") && fnDecl["#keys"]) {
            let waveEvent = adaptFromReactOrNativeKeyEvent(e);
            for (let keyDesc of fnDecl.keys || []) {
                if (checkKeyPressed(waveEvent, keyDesc)) {
                    e.preventDefault();
                    e.stopPropagation();
                    model.callVDomFunc(fnDecl, e, compId, propName);
                    return;
                }
            }
            return;
        }
        if (fnDecl.preventdefault) {
            e.preventDefault();
        }
        if (fnDecl.stoppropagation) {
            e.stopPropagation();
        }
        model.callVDomFunc(fnDecl, e, compId, propName);
    };
}

function convertElemToTag(elem: VDomElem, model: VDomModel): JSX.Element | string {
    if (elem == null) {
        return null;
    }
    if (elem.tag == TextTag) {
        return elem.text;
    }
    return React.createElement(VDomTag, { key: elem.waveid, elem, model });
}

function isObject(v: any): boolean {
    return v != null && !Array.isArray(v) && typeof v === "object";
}

function isArray(v: any): boolean {
    return Array.isArray(v);
}

function resolveBinding(binding: VDomBinding, model: VDomModel): [any, string[]] {
    const bindName = binding.bind;
    if (bindName == null || bindName == "") {
        return [null, []];
    }
    // for now we only recognize $.[atomname] bindings
    if (!bindName.startsWith("$.")) {
        return [null, []];
    }
    const atomName = bindName.substring(2);
    if (atomName == "") {
        return [null, []];
    }
    const atom = model.getAtomContainer(atomName);
    if (atom == null) {
        return [null, []];
    }
    return [atom.val, [atomName]];
}

type GenericPropsType = { [key: string]: any };

// returns props, and a set of atom keys used in the props
function convertProps(elem: VDomElem, model: VDomModel): [GenericPropsType, Set<string>] {
    let props: GenericPropsType = {};
    let atomKeys = new Set<string>();
    if (elem.props == null) {
        return [props, atomKeys];
    }
    for (let key in elem.props) {
        let val = elem.props[key];
        if (val == null) {
            continue;
        }
        if (key == "ref") {
            if (val == null) {
                continue;
            }
            if (isObject(val) && val.type == VDomObjType_Ref) {
                const valRef = val as VDomRef;
                const refContainer = model.getOrCreateRefContainer(valRef);
                props[key] = refContainer.refFn;
            }
            continue;
        }
        if (isObject(val) && val.type == VDomObjType_Func) {
            const valFunc = val as VDomFunc;
            props[key] = convertVDomFunc(model, valFunc, elem.waveid, key);
            continue;
        }
        if (isObject(val) && val.type == VDomObjType_Binding) {
            const [propVal, atomDeps] = resolveBinding(val as VDomBinding, model);
            props[key] = propVal;
            for (let atomDep of atomDeps) {
                atomKeys.add(atomDep);
            }
            continue;
        }
        if (key == "style" && isObject(val)) {
            // assuming the entire style prop wasn't bound, look through the individual keys and bind them
            for (let styleKey in val) {
                let styleVal = val[styleKey];
                if (isObject(styleVal) && styleVal.type == VDomObjType_Binding) {
                    const [stylePropVal, styleAtomDeps] = resolveBinding(styleVal as VDomBinding, model);
                    val[styleKey] = stylePropVal;
                    for (let styleAtomDep of styleAtomDeps) {
                        atomKeys.add(styleAtomDep);
                    }
                }
            }
            // fallthrough to set props[key] = val
        }
        props[key] = val;
    }
    return [props, atomKeys];
}

function convertChildren(elem: VDomElem, model: VDomModel): (string | JSX.Element)[] {
    let childrenComps: (string | JSX.Element)[] = [];
    if (elem.children == null) {
        return childrenComps;
    }
    for (let child of elem.children) {
        if (child == null) {
            continue;
        }
        childrenComps.push(convertElemToTag(child, model));
    }
    return childrenComps;
}

function stringSetsEqual(set1: Set<string>, set2: Set<string>): boolean {
    if (set1.size != set2.size) {
        return false;
    }
    for (let elem of set1) {
        if (!set2.has(elem)) {
            return false;
        }
    }
    return true;
}

function VDomTag({ elem, model }: { elem: VDomElem; model: VDomModel }) {
    const version = jotai.useAtomValue(model.getVDomNodeVersionAtom(elem));
    const [oldAtomKeys, setOldAtomKeys] = React.useState<Set<string>>(new Set());
    let [props, atomKeys] = convertProps(elem, model);
    React.useEffect(() => {
        if (stringSetsEqual(atomKeys, oldAtomKeys)) {
            return;
        }
        model.tagUnuseAtoms(elem.waveid, oldAtomKeys);
        model.tagUseAtoms(elem.waveid, atomKeys);
        setOldAtomKeys(atomKeys);
    }, [atomKeys]);
    React.useEffect(() => {
        return () => {
            model.tagUnuseAtoms(elem.waveid, oldAtomKeys);
        };
    }, []);

    if (elem.tag == WaveNullTag) {
        return null;
    }
    if (elem.tag == WaveTextTag) {
        return props.text;
    }
    if (!AllowedTags[elem.tag]) {
        return <div>{"Invalid Tag <" + elem.tag + ">"}</div>;
    }
    let childrenComps = convertChildren(elem, model);
    dlog("children", childrenComps);
    if (elem.tag == FragmentTag) {
        return childrenComps;
    }
    props.key = "e-" + elem.waveid;
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

function VDomView({
    blockId,
    nodeModel,
    viewRef,
    model,
}: {
    blockId: string;
    nodeModel: NodeModel;
    viewRef: React.RefObject<HTMLDivElement>;
    model: VDomModel;
}) {
    let rootNode = useAtomValueSafe(model?.vdomRoot);
    if (!model || viewRef.current == null || rootNode == null) {
        return null;
    }
    dlog("render", rootNode);
    model.viewRef = viewRef;
    let rtn = convertElemToTag(rootNode, model);
    return <div className="vdom">{rtn}</div>;
}

export { VDomView };
