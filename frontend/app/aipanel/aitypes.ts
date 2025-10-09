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
    tooluse: {
        toolcallid: string;
        toolname: string;
        tooldesc: string;
        status: "pending" | "error" | "completed";
        errormessage?: string;
        approval?: "needs-approval" | "user-approved" | "user-denied" | "auto-approved" | "timeout";
    };
};

export type WaveUIMessage = UIMessage<unknown, WaveUIDataTypes, {}>;
export type WaveUIMessagePart = UIMessagePart<WaveUIDataTypes, {}>;
