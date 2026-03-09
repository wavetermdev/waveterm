// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export class TabBarModel {
    private static instance: TabBarModel | null = null;

    private constructor() {}

    static getInstance(): TabBarModel {
        if (!TabBarModel.instance) {
            TabBarModel.instance = new TabBarModel();
        }
        return TabBarModel.instance;
    }
}