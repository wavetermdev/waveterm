// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type KeyPressDecl = {
    mods: {
        Cmd?: boolean;
        Option?: boolean;
        Shift?: boolean;
        Ctrl?: boolean;
        Alt?: boolean;
        Meta?: boolean;
    };
    key: string;
    keyType: string;
};
