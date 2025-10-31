// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { waveAIHasSelection } from "@/app/aipanel/waveai-focus-utils";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { WaveAIModel } from "./waveai-model";

export function handleWaveAIContextMenu(e: React.MouseEvent, onClose?: () => void): void {
    e.preventDefault();
    e.stopPropagation();

    const model = WaveAIModel.getInstance();
    const menu: ContextMenuItem[] = [];

    const hasSelection = waveAIHasSelection();
    if (hasSelection) {
        menu.push({
            role: "copy",
        });
        menu.push({ type: "separator" });
    }

    menu.push({
        label: "New Chat",
        click: () => {
            model.clearChat();
        },
    });

    menu.push({ type: "separator" });

    menu.push({
        label: "Hide Wave AI",
        click: () => {
            onClose?.();
        },
    });

    ContextMenuModel.showContextMenu(menu, e);
}