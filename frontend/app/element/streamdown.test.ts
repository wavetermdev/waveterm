import { describe, expect, it } from "vitest";

import { canSaveCommand } from "./streamdown";

describe("canSaveCommand", () => {
    it("accepts explicit shell code blocks", () => {
        expect(canSaveCommand("bash", "npm run build")).toBe(true);
        expect(canSaveCommand("pwsh", "Get-ChildItem")).toBe(true);
    });

    it("accepts shell-looking unlabeled blocks", () => {
        expect(canSaveCommand("text", "$ git status\n$ npm test")).toBe(true);
        expect(canSaveCommand("text", "docker compose up")).toBe(true);
    });

    it("rejects empty or obviously non-command blocks", () => {
        expect(canSaveCommand("text", "")).toBe(false);
        expect(canSaveCommand("javascript", "const x = 1;\nconsole.log(x);")).toBe(false);
        expect(canSaveCommand("text", "This is explanatory prose, not a command.")).toBe(false);
    });
});
