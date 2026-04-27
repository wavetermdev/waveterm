// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { shouldIncludeWidgetForWorkspace } from "./widgetfilter";

test("shouldIncludeWidgetForWorkspace includes widgets with missing or empty workspaces", () => {
    assert(shouldIncludeWidgetForWorkspace({ blockdef: { meta: {} } }, "ws-1"));
    assert(shouldIncludeWidgetForWorkspace({ blockdef: { meta: {} }, workspaces: [] }, "ws-1"));
});

test("shouldIncludeWidgetForWorkspace only includes configured workspace IDs", () => {
    assert(shouldIncludeWidgetForWorkspace({ blockdef: { meta: {} }, workspaces: ["ws-1", "ws-2"] }, "ws-1"));
    assert(!shouldIncludeWidgetForWorkspace({ blockdef: { meta: {} }, workspaces: ["ws-1", "ws-2"] }, "ws-3"));
    assert(!shouldIncludeWidgetForWorkspace({ blockdef: { meta: {} }, workspaces: ["ws-1"] }, null));
});
