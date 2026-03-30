// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { base64ToString } from "@/util/util";
import { describe, expect, it } from "vitest";
import {
    DefaultAiFileDiffModified,
    DefaultAiFileDiffOriginal,
    makeMockAiFileDiffResponse,
} from "./aifilediff.preview-util";

describe("aifilediff preview helpers", () => {
    it("encodes the default diff content for the mock rpc response", () => {
        const response = makeMockAiFileDiffResponse();

        expect(base64ToString(response.originalcontents64)).toBe(DefaultAiFileDiffOriginal);
        expect(base64ToString(response.modifiedcontents64)).toBe(DefaultAiFileDiffModified);
    });

    it("accepts custom original and modified content", () => {
        const response = makeMockAiFileDiffResponse("before", "after");

        expect(base64ToString(response.originalcontents64)).toBe("before");
        expect(base64ToString(response.modifiedcontents64)).toBe("after");
    });
});
