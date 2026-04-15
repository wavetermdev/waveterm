import { describe, expect, it } from "vitest";

import { getParentDirectory, goHistoryBack } from "./historyutil";

describe("getParentDirectory", () => {
    it("handles POSIX and home-relative paths", () => {
        expect(getParentDirectory("/")).toBe("/");
        expect(getParentDirectory("/Users/wave/Downloads")).toBe("/Users/wave");
        expect(getParentDirectory("/Users/wave/Downloads/")).toBe("/Users/wave");
        expect(getParentDirectory("~/Downloads")).toBe("~");
        expect(getParentDirectory("~")).toBe("~");
        expect(getParentDirectory("")).toBe("/");
    });

    it("handles Windows drive paths", () => {
        expect(getParentDirectory("C:\\Users\\wave\\Downloads")).toBe("C:\\Users\\wave");
        expect(getParentDirectory("C:\\Users\\wave\\Downloads\\")).toBe("C:\\Users\\wave");
        expect(getParentDirectory("C:\\Users\\wave/Downloads")).toBe("C:\\Users\\wave");
        expect(getParentDirectory("C:\\Users")).toBe("C:\\");
        expect(getParentDirectory("C:\\")).toBe("C:\\");
        expect(getParentDirectory("C:")).toBe("C:\\");
        expect(getParentDirectory("C:/Users/wave/Downloads")).toBe("C:/Users/wave");
        expect(getParentDirectory("C:/Users")).toBe("C:/");
    });

    it("handles UNC paths", () => {
        expect(getParentDirectory("\\\\server\\share\\folder")).toBe("\\\\server\\share");
        expect(getParentDirectory("\\\\server\\share\\folder\\")).toBe("\\\\server\\share");
        expect(getParentDirectory("\\\\server\\share")).toBe("\\\\server\\share");
        expect(getParentDirectory("//server/share/folder")).toBe("//server/share");
    });
});

describe("goHistoryBack", () => {
    it("falls back to Windows parent directory when history is empty", () => {
        expect(goHistoryBack("file", "C:\\Users\\wave\\Downloads", {}, true)).toEqual({
            file: "C:\\Users\\wave",
            "history:forward": ["C:\\Users\\wave\\Downloads"],
        });
    });
});
