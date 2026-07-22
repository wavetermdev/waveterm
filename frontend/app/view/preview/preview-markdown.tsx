// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { Markdown, type MarkdownHandle } from "@/element/markdown";
import { getOverrideConfigAtom } from "@/store/global";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef } from "react";
import type { SpecializedViewProps } from "./preview";

function MarkdownPreview({ model }: SpecializedViewProps) {
    const markdownRef = useRef<MarkdownHandle>(null);
    const pendingLocation = useAtomValue(model.pendingLocationAtom);
    const fileContent = useAtomValue(model.fileContent);
    useEffect(() => {
        model.refreshCallback = () => {
            globalStore.set(model.refreshVersion, (v) => v + 1);
        };
        model.captureLocationCallback = () => {
            const anchor = markdownRef.current?.getCurrentAnchor();
            return anchor ? { anchor } : null;
        };
        return () => {
            model.refreshCallback = null;
            model.captureLocationCallback = null;
        };
    }, []);
    useEffect(() => {
        if (!pendingLocation?.anchor) {
            return;
        }
        const scrolled = markdownRef.current?.scrollToAnchor(pendingLocation.anchor);
        if (scrolled) {
            globalStore.set(model.pendingLocationAtom, null);
        }
    }, [pendingLocation, fileContent]);
    const connName = useAtomValue(model.connection);
    const fileInfo = useAtomValue(model.statFile);
    const fontSizeOverride = useAtomValue(getOverrideConfigAtom(model.blockId, "markdown:fontsize"));
    const fixedFontSizeOverride = useAtomValue(getOverrideConfigAtom(model.blockId, "markdown:fixedfontsize"));
    const resolveOpts: MarkdownResolveOpts = useMemo<MarkdownResolveOpts>(() => {
        return {
            connName: connName,
            baseDir: fileInfo.dir,
        };
    }, [connName, fileInfo.dir]);
    return (
        <div className="flex flex-row h-full overflow-auto items-start justify-start">
            <Markdown
                ref={markdownRef}
                textAtom={model.fileContent}
                showTocAtom={model.markdownShowToc}
                resolveOpts={resolveOpts}
                fontSizeOverride={fontSizeOverride}
                fixedFontSizeOverride={fixedFontSizeOverride}
                contentClassName="pt-[5px] pr-[15px] pb-[10px] pl-[15px]"
            />
        </div>
    );
}

export { MarkdownPreview };
