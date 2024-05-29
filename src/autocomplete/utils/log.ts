// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modified from https://github.com/microsoft/inshellisense/blob/main/src/utils/log.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { GlobalModel } from "@/models";

export const debug = (...content) => {
    if (!GlobalModel.autocompleteModel.loggingEnabled) {
        return;
    }
    console.log("[autocomplete]", ...content);
};

export default { debug };
