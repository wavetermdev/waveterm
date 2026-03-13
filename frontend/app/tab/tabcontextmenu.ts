// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getOrefMetaKeyAtom, globalStore, recordTEvent } from "@/app/store/global";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { makeORef } from "../store/wos";
import type { TabEnv } from "./tab";

const FlagColors: { label: string; value: string }[] = [
    { label: "Green", value: "#58C142" },
    { label: "Teal", value: "#00FFDB" },
    { label: "Blue", value: "#429DFF" },
    { label: "Purple", value: "#BF55EC" },
    { label: "Red", value: "#FF453A" },
    { label: "Orange", value: "#FF9500" },
    { label: "Yellow", value: "#FFE900" },
];

function buildTabContextMenu(
    id: string,
    renameRef: React.RefObject<(() => void) | null>,
    onClose: (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null) => void,
    env: TabEnv
): ContextMenuItem[] {
    const menu: ContextMenuItem[] = [];
    menu.push(
        { label: "Rename Tab", click: () => renameRef.current?.() },
        {
            label: "Copy TabId",
            click: () => fireAndForget(() => navigator.clipboard.writeText(id)),
        },
        { type: "separator" }
    );
    const tabORef = makeORef("tab", id);
    const currentFlagColor = globalStore.get(getOrefMetaKeyAtom(tabORef, "tab:flagcolor")) ?? null;
    const flagSubmenu: ContextMenuItem[] = [
        {
            label: "None",
            type: "checkbox",
            checked: currentFlagColor == null,
            click: () =>
                fireAndForget(() =>
                    env.rpc.SetMetaCommand(TabRpcClient, { oref: tabORef, meta: { "tab:flagcolor": null } })
                ),
        },
        ...FlagColors.map((fc) => ({
            label: fc.label,
            type: "checkbox" as const,
            checked: currentFlagColor === fc.value,
            click: () =>
                fireAndForget(() =>
                    env.rpc.SetMetaCommand(TabRpcClient, { oref: tabORef, meta: { "tab:flagcolor": fc.value } })
                ),
        })),
    ];
    menu.push({ label: "Flag Tab", type: "submenu", submenu: flagSubmenu }, { type: "separator" });
    const fullConfig = globalStore.get(env.atoms.fullConfigAtom);
    const bgPresets: string[] = [];
    for (const key in fullConfig?.presets ?? {}) {
        if (key.startsWith("bg@") && fullConfig.presets[key] != null) {
            bgPresets.push(key);
        }
    }
    bgPresets.sort((a, b) => {
        const aOrder = fullConfig.presets[a]["display:order"] ?? 0;
        const bOrder = fullConfig.presets[b]["display:order"] ?? 0;
        return aOrder - bOrder;
    });
    if (bgPresets.length > 0) {
        const submenu: ContextMenuItem[] = [];
        const oref = makeORef("tab", id);
        for (const presetName of bgPresets) {
            // preset cannot be null (filtered above)
            const preset = fullConfig.presets[presetName];
            submenu.push({
                label: preset["display:name"] ?? presetName,
                click: () =>
                    fireAndForget(async () => {
                        await env.rpc.SetMetaCommand(TabRpcClient, { oref, meta: preset });
                        env.rpc.ActivityCommand(TabRpcClient, { settabtheme: 1 }, { noresponse: true });
                        recordTEvent("action:settabtheme");
                    }),
            });
        }
        menu.push({ label: "Backgrounds", type: "submenu", submenu }, { type: "separator" });
    }
    const currentTabBar = globalStore.get(env.getSettingsKeyAtom("app:tabbar")) ?? "top";
    const tabBarSubmenu: ContextMenuItem[] = [
        {
            label: "Top",
            type: "checkbox",
            checked: currentTabBar === "top",
            click: () => fireAndForget(() => env.rpc.SetConfigCommand(TabRpcClient, { "app:tabbar": "top" })),
        },
        {
            label: "Left",
            type: "checkbox",
            checked: currentTabBar === "left",
            click: () => fireAndForget(() => env.rpc.SetConfigCommand(TabRpcClient, { "app:tabbar": "left" })),
        },
    ];
    menu.push({ label: "Tab Bar Position", type: "submenu", submenu: tabBarSubmenu }, { type: "separator" });
    menu.push({ label: "Close Tab", click: () => onClose(null) });
    return menu;
}

export { buildTabContextMenu };
