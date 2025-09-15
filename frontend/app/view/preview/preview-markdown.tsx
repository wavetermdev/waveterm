// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Markdown } from "@/element/markdown";
import { getOverrideConfigAtom } from "@/store/global";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import type { SpecializedViewProps } from "./preview";

function MarkdownPreview({ model }: SpecializedViewProps) {
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
        <div className="view-preview view-preview-markdown">
            <Markdown
                textAtom={model.fileContent}
                showTocAtom={model.markdownShowToc}
                resolveOpts={resolveOpts}
                fontSizeOverride={fontSizeOverride}
                fixedFontSizeOverride={fixedFontSizeOverride}
            />
        </div>
    );
}

export { MarkdownPreview };
