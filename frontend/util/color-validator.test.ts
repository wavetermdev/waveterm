import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validateCssColor } from "./color-validator";

describe("validateCssColor", () => {
    beforeEach(() => {
        vi.stubGlobal("CSS", {
            supports: (_property: string, value: string) => {
                return [
                    "red",
                    "#aabbcc",
                    "#aabbccdd",
                    "rgb(255, 0, 0)",
                    "rgba(255, 0, 0, 0.5)",
                    "hsl(120 100% 50%)",
                    "transparent",
                    "currentColor",
                ].includes(value);
            },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("returns type for supported CSS color formats", () => {
        expect(validateCssColor("red")).toBe("keyword");
        expect(validateCssColor("#aabbcc")).toBe("hex");
        expect(validateCssColor("#aabbccdd")).toBe("hex8");
        expect(validateCssColor("rgb(255, 0, 0)")).toBe("rgb");
        expect(validateCssColor("rgba(255, 0, 0, 0.5)")).toBe("rgba");
        expect(validateCssColor("hsl(120 100% 50%)")).toBe("hsl");
        expect(validateCssColor("transparent")).toBe("transparent");
        expect(validateCssColor("currentColor")).toBe("currentcolor");
    });

    it("throws for invalid CSS colors", () => {
        expect(() => validateCssColor(":not-a-color:")).toThrow("Invalid CSS color");
        expect(() => validateCssColor("#12")).toThrow("Invalid CSS color");
        expect(() => validateCssColor("rgb(255, 0)")).toThrow("Invalid CSS color");
    });
});
