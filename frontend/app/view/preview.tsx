// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { atoms } from "@/store/global";
import { Markdown } from "@/element/markdown";

import "./view.less";

const markdownText = `
# Markdown Preview

* list item 1
* list item 2
* item 3

\`\`\`
let foo = "bar";
console.log(foo);
\`\`\`
`;

const MarkdownPreview = ({ blockData }: { blockData: BlockData }) => {
    return (
        <div className="view-preview view-preview-markdown">
            <Markdown text={markdownText} />
        </div>
    );
};

const PreviewView = ({ blockId }: { blockId: string }) => {
    const blockData: BlockData = jotai.useAtomValue(atoms.blockAtomFamily(blockId));
    if (blockData.meta?.mimetype === "text/markdown") {
        return <MarkdownPreview blockData={blockData} />;
    }
    return (
        <div className="view-preview">
            <div>Preview</div>
        </div>
    );
};

export { PreviewView };
