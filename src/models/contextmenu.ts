// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Model } from "./model";

class ContextMenuModel {
    globalModel: Model;

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
    }
}

export { ContextMenuModel };
