// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modified from https://github.com/microsoft/inshellisense/blob/main/src/utils/log.ts
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

let logEnabled = false;

const reset = async () => {};

const debug = (content: object) => {
    if (!logEnabled) {
        return;
    }
    console.log("[autocomplete]", content);
};

export const enable = async () => {
    await reset();
    logEnabled = true;
};

export default { reset, debug, enable };
