// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabV } from "@/app/tab/tab";
import { useState } from "react";

export function TabPreview() {
    const [tabName, setTabName] = useState("My Tab");

    return (
        <div style={{ position: "relative", width: 130, height: 36 }}>
            <TabV
                tabId="preview-tab-1"
                tabName={tabName}
                active={true}
                isBeforeActive={false}
                isDragging={false}
                tabWidth={130}
                isNew={false}
                indicator={null}
                onClick={() => console.log("click")}
                onClose={() => console.log("close")}
                onDragStart={() => {}}
                onContextMenu={() => {}}
                onRename={(newName) => {
                    console.log("rename", newName);
                    setTabName(newName);
                }}
            />
        </div>
    );
}
