// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WOS } from "@/store/global";

const termHeaderColors: { label: string; value: string | null }[] = [
    { label: "Default", value: null },
    { label: "Red", value: "#8b3a3a" },
    { label: "Orange", value: "#8a5528" },
    { label: "Gold", value: "#7a6840" },
    { label: "Green", value: "#2f6b45" },
    { label: "Teal", value: "#1f6e78" },
    { label: "Blue", value: "#2c4f8a" },
    { label: "Purple", value: "#5c3d82" },
    { label: "Pink", value: "#8a3d62" },
];

export function termHeaderColorMenuItems(blockId: string, headerColor: string | null | undefined): ContextMenuItem[] {
    return termHeaderColors.map((option) => {
        return {
            label: option.label,
            type: "checkbox",
            checked: option.value == null ? headerColor == null : headerColor === option.value,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: { "frame:headercolor": option.value },
                });
            },
        };
    });
}
