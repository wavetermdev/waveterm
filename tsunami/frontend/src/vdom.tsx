// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import debug from "debug";
import * as jotai from "jotai";
import * as React from "react";
import { twMerge } from "tailwind-merge";

import { AlertModal, ConfirmModal } from "@/element/modals";
import { Markdown } from "@/element/markdown";
import { Dropdown } from "@/element/dropdown";
import { getTextChildren } from "@/model/model-utils";
import type { TsunamiModel } from "@/model/tsunami-model";
import { RechartsTag } from "@/recharts/recharts";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import OptimisticInput from "./input";

const TextTag = "#text";
const FragmentTag = "#fragment";
const WaveTextTag = "wave:text";
const WaveNullTag = "wave:null";
const StyleTagName = "style";

const VDomObjType_Ref = "ref";
const VDomObjType_Func = "func";

const dlog = debug("wave:vdom");

type VDomReactTagType = (props: { elem: VDomElem; model: TsunamiModel }) => React.ReactElement;

const WaveTagMap: Record<string, VDomReactTagType> = {
    "wave:markdown": WaveMarkdown,
    "wave:dropdown": WaveDropdown,
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
    strong: true,
    em: true,
    small: true,
    sub: true,
    sup: true,
    u: true,
    mark: true,
    blockquote: true,
    section: true,
    article: true,
    header: true,
    footer: true,
    main: true,
    nav: true,
    dl: true,
    dt: true,
    dd: true,
    video: true,
    audio: true,
    picture: true,
    source: true,
    figure: true,
    figcaption: true,
    details: true,
    summary: true,
    fieldset: true,
    legend: true,
    progress: true,
    meter: true,
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

function convertVDomFunc(model: TsunamiModel, fnDecl: VDomFunc, compId: string, propName: string): (e: any) => void {
    return (e: any) => {
        if ((propName == "onKeyDown" || propName == "onKeyDownCapture") && fnDecl["keys"]) {
            dlog("key event", fnDecl, e);
            let waveEvent = adaptFromReactOrNativeKeyEvent(e);
            for (let keyDesc of fnDecl["keys"] || []) {
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

export function convertElemToTag(elem: VDomElem, model: TsunamiModel): React.ReactNode {
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

type GenericPropsType = { [key: string]: any };

function convertProps(elem: VDomElem, model: TsunamiModel): GenericPropsType {
    let props: GenericPropsType = {};
    if (elem.props == null) {
        return props;
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
        if (key == "className" && typeof val === "string") {
            props[key] = twMerge(val);
            continue;
        }
        if (isObject(val) && val.type == VDomObjType_Func) {
            const valFunc = val as VDomFunc;
            props[key] = convertVDomFunc(model, valFunc, elem.waveid, key);
            continue;
        }
        props[key] = val;
    }
    return props;
}

function convertChildren(elem: VDomElem, model: TsunamiModel): React.ReactNode[] {
    if (elem.children == null || elem.children.length == 0) {
        return null;
    }
    let childrenComps: React.ReactNode[] = [];
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

function useVDom(model: TsunamiModel, elem: VDomElem): GenericPropsType {
    const version = jotai.useAtomValue(model.getVDomNodeVersionAtom(elem)); // this triggers updates when vdom nodes change
    let props = convertProps(elem, model);
    return props;
}

function WaveMarkdown({ elem, model }: { elem: VDomElem; model: TsunamiModel }) {
    const props = useVDom(model, elem);
    return (
        <Markdown text={props?.text} style={props?.style} className={props?.className} scrollable={props?.scrollable} />
    );
}

function WaveDropdown({ elem, model }: { elem: VDomElem; model: TsunamiModel }) {
    const props = useVDom(model, elem);
    return (
        <Dropdown 
            options={props?.options} 
            value={props?.value} 
            placeholder={props?.placeholder}
            disabled={props?.disabled}
            style={props?.style} 
            className={props?.className}
            multiple={props?.multiple}
        />
    );
}

function StyleTag({ elem, model }: { elem: VDomElem; model: TsunamiModel }) {
    const styleText = getTextChildren(elem);
    if (styleText == null) {
        return null;
    }
    return <style>{styleText}</style>;
}

function VDomTag({ elem, model }: { elem: VDomElem; model: TsunamiModel }) {
    const props = useVDom(model, elem);
    if (elem.tag == WaveNullTag) {
        return null;
    }
    if (elem.tag == WaveTextTag) {
        return props.text;
    }

    // Dispatch recharts: prefixed tags to RechartsTag
    if (elem.tag.startsWith("recharts:")) {
        return <RechartsTag elem={elem} model={model} />;
    }

    const waveTag = WaveTagMap[elem.tag];
    if (waveTag) {
        return waveTag({ elem, model });
    }
    if (elem.tag == StyleTagName) {
        return <StyleTag elem={elem} model={model} />;
    }
    if (!AllowedSimpleTags[elem.tag] && !AllowedSvgTags[elem.tag]) {
        return <div>{"Invalid Tag <" + elem.tag + ">"}</div>;
    }
    let childrenComps = convertChildren(elem, model);
    if (elem.tag == FragmentTag) {
        return childrenComps;
    }

    // Use OptimisticInput for input and textarea elements
    if (elem.tag === "input" || elem.tag === "textarea") {
        props.key = "e-" + elem.waveid;
        const optimisticProps = {
            ...props,
            _tagName: elem.tag as "input" | "textarea",
        };
        return React.createElement(OptimisticInput, optimisticProps, childrenComps);
    }

    props.key = "e-" + elem.waveid;
    return React.createElement(elem.tag, props, childrenComps);
}

function VDomRoot({ model }: { model: TsunamiModel }) {
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

type VDomViewProps = {
    model: TsunamiModel;
};

function VDomInnerView({ model }: VDomViewProps) {
    let [styleMounted, setStyleMounted] = React.useState(false);
    const handleStyleLoad = () => {
        setStyleMounted(true);
    };
    return (
        <>
            <link rel="stylesheet" href={`/static/tw.css?x=${model.serverId}`} onLoad={handleStyleLoad} />
            {styleMounted ? <VDomRoot model={model} /> : null}
        </>
    );
}

function VDomView({ model }: VDomViewProps) {
    let viewRef = React.useRef(null);
    let contextActive = jotai.useAtomValue(model.contextActive);
    let currentModal = jotai.useAtomValue(model.currentModal);
    model.viewRef = viewRef;

    const handleModalClose = React.useCallback(
        (confirmed: boolean) => {
            if (currentModal) {
                model.sendModalResult(currentModal.modalid, confirmed);
            }
        },
        [model, currentModal]
    );

    return (
        <div className={clsx("overflow-auto w-full min-h-full")} ref={viewRef}>
            {contextActive ? <VDomInnerView model={model} /> : null}
            {currentModal && currentModal.modaltype === "alert" && (
                <AlertModal config={currentModal} onClose={handleModalClose} />
            )}
            {currentModal && currentModal.modaltype === "confirm" && (
                <ConfirmModal config={currentModal} onClose={handleModalClose} />
            )}
        </div>
    );
}

export { VDomView };
