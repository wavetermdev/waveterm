// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getApi, globalStore } from "./global";

type ShowContextMenuOpts = {
    onSelect?: (item: ContextMenuItem) => void;
    onCancel?: () => void;
    onClose?: (item: ContextMenuItem | null) => void;
};

class ContextMenuModel {
    private static instance: ContextMenuModel;
    handlers: Map<string, ContextMenuItem> = new Map(); // id -> item
    activeOpts: ShowContextMenuOpts | null = null;

    private constructor() {
        getApi().onContextMenuClick(this.handleContextMenuClick.bind(this));
    }

    static getInstance(): ContextMenuModel {
        if (ContextMenuModel.instance == null) {
            ContextMenuModel.instance = new ContextMenuModel();
        }
        return ContextMenuModel.instance;
    }

    handleContextMenuClick(id: string | null): void {
        const opts = this.activeOpts;
        this.activeOpts = null;
        const item = id != null ? this.handlers.get(id) : null;
        this.handlers.clear();
        if (item == null) {
            opts?.onCancel?.();
            opts?.onClose?.(null);
            return;
        }
        item.click?.();
        opts?.onSelect?.(item);
        opts?.onClose?.(item);
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
                this.handlers.set(electronItem.id, item);
            }
            if (item.submenu) {
                electronItem.submenu = this._convertAndRegisterMenu(item.submenu);
            }
            electronMenuItems.push(electronItem);
        }
        return electronMenuItems;
    }

    showContextMenu(menu: ContextMenuItem[], ev: React.MouseEvent<any>, opts?: ShowContextMenuOpts): void {
        ev.stopPropagation();
        this.handlers.clear();
        this.activeOpts = opts;
        const electronMenuItems = this._convertAndRegisterMenu(menu);
        
        const workspace = globalStore.get(atoms.workspace);
        let oid: string;
        
        if (workspace != null) {
            oid = workspace.oid;
        } else {
            oid = globalStore.get(atoms.builderId);
        }
        
        getApi().showContextMenu(oid, electronMenuItems);
    }
}

export { ContextMenuModel };
