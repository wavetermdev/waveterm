// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getAtoms } from "./global-atoms";

describe("global-atoms", () => {
    it("throws before initialization", () => {
        expect(() => getAtoms()).toThrow("Global atoms accessed before initialization");
    });
});
