// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { UIMessage, UIMessagePart } from "ai";

type WaveUIDataTypes = {
    userfile: {
        filename: string;
        size: number;
        mimetype: string;
        previewurl?: string;
    };
};

export type WaveUIMessage = UIMessage<unknown, WaveUIDataTypes, {}>;
export type WaveUIMessagePart = UIMessagePart<WaveUIDataTypes, {}>;
