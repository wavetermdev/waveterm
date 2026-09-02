// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getBlockUploadStateAtom, setBlockUploadState } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";

describe("block upload state", () => {
    it("sets and clears the block upload overlay state", () => {
        const state = { active: true, fileName: "a.txt", fileSize: 100 };
        setBlockUploadState("block-x", state);
        expect(globalStore.get(getBlockUploadStateAtom("block-x"))).toEqual(state);

        setBlockUploadState("block-x", null);
        expect(globalStore.get(getBlockUploadStateAtom("block-x"))).toBeNull();
    });
});
