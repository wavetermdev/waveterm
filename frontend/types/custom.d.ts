// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

declare global {
    type TabData = {
        name: string;
        tabid: string;
        blockIds: string[];
    };

    type BlockData = {
        blockid: string;
        view: string;
    };
}

export {};
