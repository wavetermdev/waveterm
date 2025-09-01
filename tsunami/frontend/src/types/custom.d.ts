// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// vdom.WaveKeyboardEvent
type WaveKeyboardEvent = {
    type: "keydown" | "keyup" | "keypress" | "unknown";
    key: string;
    code: string;
    repeat?: boolean;
    location?: number;
    shift?: boolean;
    control?: boolean;
    alt?: boolean;
    meta?: boolean;
    cmd?: boolean;
    option?: boolean;
};

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
