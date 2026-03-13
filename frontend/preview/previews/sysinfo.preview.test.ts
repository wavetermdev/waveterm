// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DefaultSysinfoHistoryPoints, makeMockSysinfoEvent, makeMockSysinfoHistory } from "./sysinfo.preview-util";

describe("sysinfo preview helpers", () => {
    it("creates sysinfo events with the expected metrics", () => {
        const event = makeMockSysinfoEvent(1000, 3);

        expect(event.event).toBe("sysinfo");
        expect(event.scopes).toEqual(["local"]);
        expect(event.data.ts).toBe(1000);
        expect(event.data.values.cpu).toBeGreaterThanOrEqual(0);
        expect(event.data.values.cpu).toBeLessThanOrEqual(100);
        expect(event.data.values["mem:used"]).toBeGreaterThan(0);
        expect(event.data.values["mem:total"]).toBeGreaterThan(event.data.values["mem:used"]);
        expect(event.data.values["cpu:0"]).toBeTypeOf("number");
    });

    it("creates evenly spaced sysinfo history", () => {
        const history = makeMockSysinfoHistory(4, 4000);

        expect(history).toHaveLength(4);
        expect(history.map((event) => event.data.ts)).toEqual([1000, 2000, 3000, 4000]);
    });

    it("uses the default history length", () => {
        expect(makeMockSysinfoHistory()).toHaveLength(DefaultSysinfoHistoryPoints);
    });
});
