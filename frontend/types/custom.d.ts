// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

declare global {
    type TabLayoutData = {
        blockId: string;
    };

    type ContextMenuOpts = {
        showCut?: boolean;
        onlyPaste?: boolean;
    };

    type ElectronApi = {
        /**
         * Determines whether the current app instance is a development build.
         * @returns True if the current app instance is a development build.
         */
        isDev: () => boolean;
        /**
         * Determines whether the current app instance is hosted in a Vite dev server.
         * @returns True if the current app instance is hosted in a Vite dev server.
         */
        isDevServer: () => boolean;
        /**
         * Get a point value representing the cursor's position relative to the calling BrowserWindow
         * @returns A point value.
         */
        getCursorPoint: () => Electron.Point;

        contextEditMenu: (position: { x: number; y: number }, opts: ContextMenuOpts) => void;
        showContextMenu: (menu: ElectronContextMenuItem[], position: { x: number; y: number }) => void;
        onContextMenuClick: (callback: (id: string) => void) => void;
    };

    type ElectronContextMenuItem = {
        id: string; // unique id, used for communication
        label: string;
        role?: string; // electron role (optional)
        type?: "separator" | "normal" | "submenu";
        submenu?: ElectronContextMenuItem[];
    };

    type ContextMenuItem = {
        label?: string;
        type?: "separator" | "normal" | "submenu";
        role?: string; // electron role (optional)
        click?: () => void; // not required if role is set
        submenu?: ContextMenuItem[];
    };

    type SubjectWithRef<T> = rxjs.Subject<T> & { refCount: number; release: () => void };
}

export {};
