// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getApi, globalStore } from "./global";

class ContextMenuModelType {
    handlers: Map<string, () => void> = new Map(); // id -> handler

    constructor() {
        getApi().onContextMenuClick(this.handleContextMenuClick.bind(this));
    }

    handleContextMenuClick(id: string): void {
        const handler = this.handlers.get(id);
        if (handler) {
            handler();
        }
    }

    _convertAndRegisterMenu(menu: ContextMenuItem[]): ElectronContextMenuItem[] {
        const electronMenuItems: ElectronContextMenuItem[] = [];
        for (const item of menu) {
            const electronItem: ElectronContextMenuItem = {
                role: item.role,
                type: item.type,
                label: item.label,
                sublabel: item.sublabel,
                id: crypto.randomUUID(),
                checked: item.checked,
            };
            if (item.visible === false) {
                electronItem.visible = false;
            }
            if (item.enabled === false) {
                electronItem.enabled = false;
            }
            if (item.click) {
                this.handlers.set(electronItem.id, item.click);
            }
            if (item.submenu) {
                electronItem.submenu = this._convertAndRegisterMenu(item.submenu);
            }
            electronMenuItems.push(electronItem);
        }
        return electronMenuItems;
    }

    showContextMenu(menu: ContextMenuItem[], ev: React.MouseEvent<any>): void {
        ev.stopPropagation();
        this.handlers.clear();
        const electronMenuItems = this._convertAndRegisterMenu(menu);

        const workspace = globalStore.get(atoms.workspace);
        const oid = workspace?.oid ?? "";

        getApi().showContextMenu(oid, electronMenuItems);
    }
}

const ContextMenuModel = new ContextMenuModelType();

export { ContextMenuModel, ContextMenuModelType };
