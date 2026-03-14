// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { makeMockWaveEnv } from "@/preview/mock/mockwaveenv";
import { describe, expect, it } from "vitest";
import type { PreviewEnv } from "./previewenv";

describe("PreviewEnv", () => {
    it("is satisfied by the existing mock wave env", () => {
        const env: PreviewEnv = makeMockWaveEnv();

        expect(env.rpc.FetchSuggestionsCommand).toBeTypeOf("function");
        expect(env.rpc.FileReadCommand).toBeTypeOf("function");
        expect(env.rpc.SetConfigCommand).toBeTypeOf("function");
        expect(env.electron.onQuicklook).toBeTypeOf("function");
        expect(env.atoms.fullConfigAtom).toBeTruthy();
    });
});
