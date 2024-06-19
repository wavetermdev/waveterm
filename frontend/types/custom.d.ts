// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

declare global {
    type TabLayoutData = {
        blockId: string;
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
    };

    type SubjectWithRef<T> = rxjs.Subject<T> & { refCount: number; release: () => void };
}

export {};
