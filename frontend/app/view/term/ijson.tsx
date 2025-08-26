// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import Frame from "react-frame-component";

type IJsonNode = {
    tag: string;
    props?: Record<string, any>;
    children?: (IJsonNode | string)[];
};

const TagMap: Record<string, React.ComponentType<{ node: IJsonNode }>> = {};

function convertNodeToTag(node: IJsonNode | string, idx?: number): React.ReactNode {
    if (node == null) {
        return null;
    }
    if (idx == null) {
        idx = 0;
    }
    if (typeof node === "string") {
        return node;
    }
    let key = node.props?.key ?? "child-" + idx;
    let TagComp = TagMap[node.tag];
    if (!TagComp) {
        return <div key={key}>Unknown tag:{node.tag}</div>;
    }
    return <TagComp key={key} node={node} />;
}

function IJsonHtmlTag({ node }: { node: IJsonNode }) {
    let { tag, props, children } = node;
    let divProps = {};
    if (props != null) {
        for (let [key, val] of Object.entries(props)) {
            if (key.startsWith("on")) {
                divProps[key] = (e: any) => {
                    console.log("handler", key, val);
                };
            } else {
                divProps[key] = val;
            }
        }
    }
    let childrenComps: React.ReactNode[] = [];
    if (children != null) {
        for (let idx = 0; idx < children.length; idx++) {
            let comp = convertNodeToTag(children[idx], idx);
            if (comp != null) {
                childrenComps.push(comp);
            }
        }
    }
    return React.createElement(tag, divProps, childrenComps);
}

TagMap["div"] = IJsonHtmlTag;
TagMap["b"] = IJsonHtmlTag;
TagMap["i"] = IJsonHtmlTag;
TagMap["p"] = IJsonHtmlTag;
TagMap["s"] = IJsonHtmlTag;
TagMap["span"] = IJsonHtmlTag;
TagMap["a"] = IJsonHtmlTag;
TagMap["img"] = IJsonHtmlTag;
TagMap["h1"] = IJsonHtmlTag;
TagMap["h2"] = IJsonHtmlTag;
TagMap["h3"] = IJsonHtmlTag;
TagMap["h4"] = IJsonHtmlTag;
TagMap["h5"] = IJsonHtmlTag;
TagMap["h6"] = IJsonHtmlTag;
TagMap["ul"] = IJsonHtmlTag;
TagMap["ol"] = IJsonHtmlTag;
TagMap["li"] = IJsonHtmlTag;
TagMap["input"] = IJsonHtmlTag;
TagMap["button"] = IJsonHtmlTag;
TagMap["textarea"] = IJsonHtmlTag;
TagMap["select"] = IJsonHtmlTag;
TagMap["option"] = IJsonHtmlTag;
TagMap["form"] = IJsonHtmlTag;

function IJsonView({ rootNode }: { rootNode: IJsonNode }) {
    // TODO fix this huge inline style
    return (
        <div className="ijson">
            <Frame>
                <style>
                    {`
*::before, *::after { box-sizing: border-box; }
* { margin: 0; }
body { line-height: 1.2; -webkit-font-smoothing: antialiased; }
img, picture, video, canvas, sgv { display: block; }
input, button, textarea, select { font: inherit; }

body {
	display: flex;
	flex-direction: column;
	width: 100vw;
	height: 100vh;
	background-color: #000;
	color: #fff;
	font: normal 15px / normal "Lato", sans-serif;
}

.fixed-font {
	normal 12px / normal "Hack", monospace;
}
					`}
                </style>
                {convertNodeToTag(rootNode)}
            </Frame>
        </div>
    );
}

export { IJsonView };
