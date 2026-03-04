// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalModel } from "./global-model";

const { setIsActiveMock } = vi.hoisted(() => ({
    setIsActiveMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/store/global", () => ({
    getApi: () => ({
        setIsActive: setIsActiveMock,
    }),
}));

describe("GlobalModel", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        vi.clearAllMocks();
        (GlobalModel as any).instance = null;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("throttles setIsActive to once every 5 seconds", async () => {
        const model = GlobalModel.getInstance();

        await model.setIsActive();
        await model.setIsActive();
        expect(setIsActiveMock).toHaveBeenCalledTimes(1);

        vi.setSystemTime(new Date(Date.now() + 5000));
        await model.setIsActive();
        expect(setIsActiveMock).toHaveBeenCalledTimes(2);
    });
});
