// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

describe("GlobalModel.setIsActive", () => {
    it("calls fireAndForget once and throttles repeated mousedown activity", async () => {
        const setIsActive = vi.fn().mockResolvedValue(undefined);
        const fireAndForget = vi.fn((f: () => Promise<any>) => {
            void f();
        });

        vi.resetModules();
        vi.doMock("@/store/global", () => ({
            getApi: () => ({ setIsActive }),
        }));
        vi.doMock("@/util/util", async (importOriginal) => {
            const actual = await importOriginal<typeof import("@/util/util")>();
            return {
                ...actual,
                fireAndForget,
            };
        });

        const { GlobalModel } = await import("./global-model");
        const model = GlobalModel.getInstance();

        const result = model.setIsActive();
        model.setIsActive();

        expect(result).toBeUndefined();
        expect(fireAndForget).toHaveBeenCalledTimes(1);
        expect(setIsActive).toHaveBeenCalledTimes(1);
    });

    it("logs and swallows setIsActive telemetry errors", async () => {
        const error = new Error("telemetry failed");
        const setIsActive = vi.fn().mockRejectedValue(error);
        const fireAndForget = vi.fn((f: () => Promise<any>) => {
            void f();
        });
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        vi.resetModules();
        vi.doMock("@/store/global", () => ({
            getApi: () => ({ setIsActive }),
        }));
        vi.doMock("@/util/util", async (importOriginal) => {
            const actual = await importOriginal<typeof import("@/util/util")>();
            return {
                ...actual,
                fireAndForget,
            };
        });

        const { GlobalModel } = await import("./global-model");
        const model = GlobalModel.getInstance();
        model.setIsActive();
        await Promise.resolve();

        expect(fireAndForget).toHaveBeenCalledTimes(1);
        expect(logSpy).toHaveBeenCalledWith("setIsActive error", error);

        logSpy.mockRestore();
    });
});
