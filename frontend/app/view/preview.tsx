// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { atoms, blockDataMap, useBlockAtom } from "@/store/global";
import { Markdown } from "@/element/markdown";
import * as FileService from "@/bindings/pkg/service/fileservice/FileService";
import * as util from "@/util/util";
import { loadable } from "jotai/utils";

import "./view.less";

const MarkdownPreview = ({ contentAtom }: { contentAtom: jotai.Atom<Promise<string>> }) => {
    const readmeText = jotai.useAtomValue(contentAtom);
    return (
        <div className="view-preview view-preview-markdown">
            <Markdown text={readmeText} />
        </div>
    );
};

let counter = 0;

const PreviewView = ({ blockId }: { blockId: string }) => {
    const blockDataAtom: jotai.Atom<BlockData> = blockDataMap.get(blockId);
    const fileNameAtom = useBlockAtom(blockId, "preview:filename", () =>
        jotai.atom<string>((get) => {
            return get(blockDataAtom)?.meta?.file;
        })
    );
    const fullFileAtom = useBlockAtom(blockId, "preview:fullfile", () =>
        jotai.atom<Promise<FullFile>>(async (get) => {
            const fileName = get(fileNameAtom);
            if (fileName == null) {
                return null;
            }
            const file = await FileService.ReadFile(fileName);
            return file;
        })
    );
    const fileMimeTypeAtom = useBlockAtom(blockId, "preview:mimetype", () =>
        jotai.atom<Promise<string>>(async (get) => {
            const fullFile = await get(fullFileAtom);
            return fullFile?.info?.mimetype;
        })
    );
    const fileContentAtom = useBlockAtom(blockId, "preview:filecontent", () =>
        jotai.atom<Promise<string>>(async (get) => {
            const fullFile = await get(fullFileAtom);
            return util.base64ToString(fullFile?.data64);
        })
    );
    let mimeType = jotai.useAtomValue(fileMimeTypeAtom);
    if (mimeType == null) {
        mimeType = "";
    }
    if (mimeType === "text/markdown") {
        return <MarkdownPreview contentAtom={fileContentAtom} />;
    }
    if (mimeType.startsWith("text/")) {
        return (
            <div className="view-preview view-preview-text">
                <pre>{jotai.useAtomValue(fileContentAtom)}</pre>
            </div>
        );
    }
    return (
        <div className="view-preview">
            <div>Preview ({mimeType})</div>
        </div>
    );
};

export { PreviewView };
