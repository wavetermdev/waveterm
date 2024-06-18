// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

declare global {
    type TabLayoutData = {
        blockId: string;
    };

    type ElectronApi = {
        isDev: () => boolean;
        isDevServer: () => boolean;
    };

    type SubjectWithRef<T> = rxjs.Subject<T> & { refCount: number; release: () => void };
}

export {};
