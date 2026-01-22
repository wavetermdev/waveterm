// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ChatRequestOptions, FileUIPart, UIMessage, UIMessagePart } from "ai";

type WaveUIDataTypes = {
    // pkg/aiusechat/uctypes/uctypes.go UIMessageDataUserFile
    userfile: {
        filename: string;
        size: number;
        mimetype: string;
        previewurl?: string;
    };
    // pkg/aiusechat/uctypes/uctypes.go UIMessageDataToolUse
    tooluse: {
        toolcallid: string;
        toolname: string;
        tooldesc: string;
        status: "pending" | "error" | "completed";
        runts?: number;
        errormessage?: string;
        approval?: "needs-approval" | "user-approved" | "user-denied" | "auto-approved" | "timeout";
        blockid?: string;
        writebackupfilename?: string;
        inputfilename?: string;
    };

    toolprogress: {
        toolcallid: string;
        toolname: string;
        statuslines: string[];
    };
};

export type WaveUIMessage = UIMessage<unknown, WaveUIDataTypes, {}>;
export type WaveUIMessagePart = UIMessagePart<WaveUIDataTypes, {}>;

export type UseChatSetMessagesType = (
    messages: WaveUIMessage[] | ((messages: WaveUIMessage[]) => WaveUIMessage[])
) => void;

export type UseChatSendMessageType = (
    message?:
        | (Omit<WaveUIMessage, "id" | "role"> & {
              id?: string;
              role?: "system" | "user" | "assistant";
          } & {
              text?: never;
              files?: never;
              messageId?: string;
          })
        | {
              text: string;
              files?: FileList | FileUIPart[];
              metadata?: unknown;
              parts?: never;
              messageId?: string;
          }
        | {
              files: FileList | FileUIPart[];
              metadata?: unknown;
              parts?: never;
              messageId?: string;
          },
    options?: ChatRequestOptions
) => Promise<void>;
