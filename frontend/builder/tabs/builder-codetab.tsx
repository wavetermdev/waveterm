// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import { memo } from "react";

const BuilderCodeTab = memo(() => {
    return (
        <div className="w-full h-full">
            <CodeEditor blockId="" text="" readonly={false} />
        </div>
    );
});

BuilderCodeTab.displayName = "BuilderCodeTab";

export { BuilderCodeTab };
