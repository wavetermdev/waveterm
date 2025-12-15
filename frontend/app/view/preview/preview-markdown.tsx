// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Markdown } from "@/element/markdown";
import { getOverrideConfigAtom, globalStore } from "@/store/global";
import { useAtomValue } from "jotai";
import { useEffect, useMemo } from "react";
import type { SpecializedViewProps } from "./preview";

function MarkdownPreview({ model }: SpecializedViewProps) {
    useEffect(() => {
        model.refreshCallback = () => {
            globalStore.set(model.refreshVersion, (v) => v + 1);
        };
        return () => {
            model.refreshCallback = null;
        };
    }, []);
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
