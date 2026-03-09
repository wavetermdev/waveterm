import { describe, expect, it } from "vitest";
import { PlatformMacOS, PlatformWindows } from "@/util/platformutil";
import { applyMockEnvOverrides, makeMockWaveEnv } from "./mockwaveenv";

describe("makeMockWaveEnv", () => {
    it("defaults the platform to macOS", () => {
        const env = makeMockWaveEnv();

        expect(env.platform).toBe(PlatformMacOS);
        expect(env.electron.getPlatform()).toBe(PlatformMacOS);
        expect(env.isMacOS()).toBe(true);
        expect(env.isWindows()).toBe(false);
    });

    it("allows overriding the platform", () => {
        const env = makeMockWaveEnv({ platform: PlatformWindows });

        expect(env.platform).toBe(PlatformWindows);
        expect(env.electron.getPlatform()).toBe(PlatformWindows);
        expect(env.isMacOS()).toBe(false);
        expect(env.isWindows()).toBe(true);
    });

    it("preserves platform overrides when applying mock env overrides", () => {
        const env = makeMockWaveEnv();
        const updatedEnv = applyMockEnvOverrides(env, { platform: PlatformWindows });

        expect(updatedEnv.platform).toBe(PlatformWindows);
        expect(updatedEnv.isWindows()).toBe(true);
        expect(updatedEnv.isMacOS()).toBe(false);
    });
});
