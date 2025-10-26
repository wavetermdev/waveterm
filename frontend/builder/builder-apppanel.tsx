// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BuilderCodeTab } from "@/builder/tabs/builder-codetab";
import { BuilderFilesTab } from "@/builder/tabs/builder-filestab";
import { BuilderPreviewTab } from "@/builder/tabs/builder-previewtab";
import { cn } from "@/util/util";
import { memo, useState } from "react";

type TabType = "preview" | "files" | "code";

const BuilderAppPanel = memo(() => {
    const [activeTab, setActiveTab] = useState<TabType>("preview");

    return (
        <div className="w-full h-full flex flex-col border-b border-border">
            <div className="flex-shrink-0 border-b border-border">
                <div className="flex">
                    <button
                        className={cn(
                            "px-4 py-2 text-sm font-medium transition-colors cursor-pointer",
                            activeTab === "preview"
                                ? "text-main-text border-b-2 border-accent"
                                : "text-secondary hover:text-main-text"
                        )}
                        onClick={() => setActiveTab("preview")}
                    >
                        Preview
                    </button>
                    <button
                        className={cn(
                            "px-4 py-2 text-sm font-medium transition-colors cursor-pointer",
                            activeTab === "files"
                                ? "text-main-text border-b-2 border-accent"
                                : "text-secondary hover:text-main-text"
                        )}
                        onClick={() => setActiveTab("files")}
                    >
                        Files
                    </button>
                    <button
                        className={cn(
                            "px-4 py-2 text-sm font-medium transition-colors cursor-pointer",
                            activeTab === "code"
                                ? "text-main-text border-b-2 border-accent"
                                : "text-secondary hover:text-main-text"
                        )}
                        onClick={() => setActiveTab("code")}
                    >
                        Code
                    </button>
                </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
                {activeTab === "preview" && <BuilderPreviewTab />}
                {activeTab === "files" && <BuilderFilesTab />}
                {activeTab === "code" && <BuilderCodeTab />}
            </div>
        </div>
    );
});

BuilderAppPanel.displayName = "BuilderAppPanel";

export { BuilderAppPanel };