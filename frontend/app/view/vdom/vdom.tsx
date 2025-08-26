// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Markdown } from "@/app/element/markdown";
import { VDomModel } from "@/app/view/vdom/vdom-model";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import clsx from "clsx";
import debug from "debug";
import * as jotai from "jotai";
import * as React from "react";

import { BlockNodeModel } from "@/app/block/blocktypes";
import {
    convertVDomId,
    getTextChildren,
    validateAndWrapCss,
    validateAndWrapReactStyle,
} from "@/app/view/vdom/vdom-utils";
import "./vdom.scss";

const TextTag = "#text";
const FragmentTag = "#fragment";
const WaveTextTag = "wave:text";
const WaveNullTag = "wave:null";
const StyleTagName = "style";
const WaveStyleTagName = "wave:style";

const VDomObjType_Ref = "ref";
const VDomObjType_Binding = "binding";
const VDomObjType_Func = "func";

const dlog = debug("wave:vdom");

type VDomReactTagType = (props: { elem: VDomElem; model: VDomModel }) => React.ReactElement;

const WaveTagMap: Record<string, VDomReactTagType> = {
    "wave:markdown": WaveMarkdown,
};

const AllowedSimpleTags: { [tagName: string]: boolean } = {
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
    label: true,
    table: true,
    thead: true,
    tbody: true,
    tr: true,
    th: true,
    td: true,
    hr: true,
    br: true,
    pre: true,
    code: true,
    canvas: true,
};

const AllowedSvgTags = {
    // SVG tags
    svg: true,
    circle: true,
    ellipse: true,
    line: true,
    path: true,
    polygon: true,
    polyline: true,
    rect: true,
    g: true,
    text: true,
    tspan: true,
    textPath: true,
    use: true,
    defs: true,
    linearGradient: true,
    radialGradient: true,
    stop: true,
    clipPath: true,
    mask: true,
    pattern: true,
    image: true,
    marker: true,
    symbol: true,
    filter: true,
    feBlend: true,
    feColorMatrix: true,
    feComponentTransfer: true,
    feComposite: true,
    feConvolveMatrix: true,
    feDiffuseLighting: true,
    feDisplacementMap: true,
    feFlood: true,
    feGaussianBlur: true,
    feImage: true,
    feMerge: true,
    feMorphology: true,
    feOffset: true,
    feSpecularLighting: true,
    feTile: true,
    feTurbulence: true,
};

const IdAttributes = {
    id: true,
    for: true,
    "aria-labelledby": true,
    "aria-describedby": true,
    "aria-controls": true,
    "aria-owns": true,
    form: true,
    headers: true,
    usemap: true,
    list: true,
};

const SvgUrlIdAttributes = {
    "clip-path": true,
    mask: true,
    filter: true,
    fill: true,
    stroke: true,
    "marker-start": true,
    "marker-mid": true,
    "marker-end": true,
    "text-decoration": true,
};

function convertVDomFunc(model: VDomModel, fnDecl: VDomFunc, compId: string, propName: string): (e: any) => void {
    return (e: any) => {
        if ((propName == "onKeyDown" || propName == "onKeyDownCapture") && fnDecl["#keys"]) {
            dlog("key event", fnDecl, e);
            let waveEvent = adaptFromReactOrNativeKeyEvent(e);
            for (let keyDesc of fnDecl["#keys"] || []) {
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

function convertElemToTag(elem: VDomElem, model: VDomModel): React.ReactElement | string {
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
            val = validateAndWrapReactStyle(model, val);
            props[key] = val;
            continue;
        }
        if (IdAttributes[key]) {
            props[key] = convertVDomId(model, val);
            continue;
        }
        if (AllowedSvgTags[elem.tag]) {
            if ((elem.tag == "use" && key == "href") || (elem.tag == "textPath" && key == "href")) {
                if (val == null || !val.startsWith("#")) {
                    continue;
                }
                props[key] = convertVDomId(model, "#" + val.substring(1));
                continue;
            }
            if (SvgUrlIdAttributes[key]) {
                if (val == null || !val.startsWith("url(#") || !val.endsWith(")")) {
                    continue;
                }
                props[key] = "url(#" + convertVDomId(model, val.substring(4, val.length - 1)) + ")";
                continue;
            }
        }
        if (key == "src" && val != null && val.startsWith("vdom://")) {
            // transform vdom:// urls
            const newUrl = model.transformVDomUrl(val);
            if (newUrl == null) {
                continue;
            }
            props[key] = newUrl;
            continue;
        }
        props[key] = val;
    }
    return [props, atomKeys];
}

function convertChildren(elem: VDomElem, model: VDomModel): (string | React.ReactElement)[] {
    if (elem.children == null || elem.children.length == 0) {
        return null;
    }
    let childrenComps: (string | React.ReactElement)[] = [];
    for (let child of elem.children) {
        if (child == null) {
            continue;
        }
        childrenComps.push(convertElemToTag(child, model));
    }
    if (childrenComps.length == 0) {
        return null;
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

function useVDom(model: VDomModel, elem: VDomElem): GenericPropsType {
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
    return props;
}

function WaveMarkdown({ elem, model }: { elem: VDomElem; model: VDomModel }) {
    const props = useVDom(model, elem);
    return (
        <Markdown
            text={props?.text}
            style={props?.style}
            className={props?.className}
            scrollable={props?.scrollable}
            rehype={props?.rehype}
        />
    );
}

function StyleTag({ elem, model }: { elem: VDomElem; model: VDomModel }) {
    const styleText = getTextChildren(elem);
    if (styleText == null) {
        return null;
    }
    const wrapperClassName = "vdom-" + model.blockId;
    // TODO handle errors
    const sanitizedCss = validateAndWrapCss(model, styleText, wrapperClassName);
    if (sanitizedCss == null) {
        return null;
    }
    return <style>{sanitizedCss}</style>;
}

function WaveStyle({ src, model, onMount }: { src: string; model: VDomModel; onMount?: () => void }) {
    const [styleContent, setStyleContent] = React.useState<string | null>(null);
    React.useEffect(() => {
        async function fetchAndSanitizeCss() {
            try {
                const response = await fetch(src);
                if (!response.ok) {
                    console.error(`Failed to load CSS from ${src}`);
                    return;
                }
                const cssText = await response.text();
                const wrapperClassName = "vdom-" + model.blockId;
                const sanitizedCss = validateAndWrapCss(model, cssText, wrapperClassName);
                if (sanitizedCss) {
                    setStyleContent(sanitizedCss);
                } else {
                    onMount?.();
                    console.error("Failed to sanitize CSS");
                }
            } catch (error) {
                console.error("Error fetching CSS:", error);
                onMount?.();
            }
        }
        fetchAndSanitizeCss();
    }, [src, model]);
    // Trigger onMount after styleContent has been set and mounted
    React.useEffect(() => {
        if (styleContent) {
            onMount?.();
        }
    }, [styleContent, onMount]);
    if (!styleContent) {
        return null;
    }
    return <style>{styleContent}</style>;
}

function VDomTag({ elem, model }: { elem: VDomElem; model: VDomModel }) {
    const props = useVDom(model, elem);
    if (elem.tag == WaveNullTag) {
        return null;
    }
    if (elem.tag == WaveTextTag) {
        return props.text;
    }
    const waveTag = WaveTagMap[elem.tag];
    if (waveTag) {
        return waveTag({ elem, model });
    }
    if (elem.tag == StyleTagName) {
        return <StyleTag elem={elem} model={model} />;
    }
    if (elem.tag == WaveStyleTagName) {
        return <WaveStyle src={props.src} model={model} />;
    }
    if (!AllowedSimpleTags[elem.tag] && !AllowedSvgTags[elem.tag]) {
        return <div>{"Invalid Tag <" + elem.tag + ">"}</div>;
    }
    let childrenComps = convertChildren(elem, model);
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

function VDomRoot({ model }: { model: VDomModel }) {
    let version = jotai.useAtomValue(model.globalVersion);
    let rootNode = jotai.useAtomValue(model.vdomRoot);
    React.useEffect(() => {
        model.renderDone(version);
    }, [version]);
    if (model.viewRef.current == null || rootNode == null) {
        return null;
    }
    dlog("render", version, rootNode);
    let rtn = convertElemToTag(rootNode, model);
    return <div className="vdom">{rtn}</div>;
}

function makeVDomModel(blockId: string, nodeModel: BlockNodeModel): VDomModel {
    return new VDomModel(blockId, nodeModel);
}

type VDomViewProps = {
    model: VDomModel;
    blockId: string;
};

function VDomInnerView({ blockId, model }: VDomViewProps) {
    let [styleMounted, setStyleMounted] = React.useState(!model.backendOpts?.globalstyles);
    const handleStylesMounted = () => {
        setStyleMounted(true);
    };
    return (
        <>
            {model.backendOpts?.globalstyles ? (
                <WaveStyle src={model.makeVDomUrl("/wave/global.css")} model={model} onMount={handleStylesMounted} />
            ) : null}
            {styleMounted ? <VDomRoot model={model} /> : null}
        </>
    );
}

function VDomView({ blockId, model }: VDomViewProps) {
    let viewRef = React.useRef(null);
    let contextActive = jotai.useAtomValue(model.contextActive);
    model.viewRef = viewRef;
    const vdomClass = "vdom-" + blockId;
    return (
        <div className={clsx("view-vdom", vdomClass)} ref={viewRef}>
            {contextActive ? <VDomInnerView blockId={blockId} model={model} /> : null}
        </div>
    );
}

export { makeVDomModel, VDomView };
