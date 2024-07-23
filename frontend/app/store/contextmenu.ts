// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { v4 as uuidv4 } from "uuid";
import { getApi } from "./global";

class ContextMenuModelType {
    handlers: Map<string, () => void> = new Map(); // id -> handler

    constructor() {
        getApi().onContextMenuClick(this.handleContextMenuClick.bind(this));
    }

    handleContextMenuClick(id: string): void {
        let handler = this.handlers.get(id);
        if (handler) {
            handler();
        }
    }

    _convertAndRegisterMenu(menu: ContextMenuItem[]): ElectronContextMenuItem[] {
        let electronMenuItems: ElectronContextMenuItem[] = [];
        for (let item of menu) {
            let electronItem: ElectronContextMenuItem = {
                role: item.role,
                type: item.type,
                label: item.label,
                id: uuidv4(),
            };
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
        this.handlers.clear();
        const electronMenuItems = this._convertAndRegisterMenu(menu);
        getApi().showContextMenu(electronMenuItems, { x: ev.clientX, y: ev.clientY });
    }
}

const ContextMenuModel = new ContextMenuModelType();

export { ContextMenuModel, ContextMenuModelType };
