// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { getWidgetsMode } from "./widgets";

test("getWidgetsMode returns normal when the measured content fits", () => {
    assert.equal(getWidgetsMode(240, 225, 6), "normal");
});

test("getWidgetsMode returns compact when normal content overflows but compact height still fits", () => {
    assert.equal(getWidgetsMode(240, 260, 6), "compact");
});

test("getWidgetsMode returns supercompact when even the compact layout would overflow", () => {
    assert.equal(getWidgetsMode(120, 260, 6), "supercompact");
});
