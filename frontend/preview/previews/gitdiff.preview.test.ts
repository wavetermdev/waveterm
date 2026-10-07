// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isSameFileDiff, isWshOutdatedError, splitRepoPath } from "@/app/view/gitdiff/gitdiff-util";
import { base64ToString } from "@/util/util";
import { describe, expect, it } from "vitest";
import { MockGitFiles, makeMockGitFileDiff, makeMockGitStatus } from "./gitdiff.preview-util";

describe("gitdiff preview helpers", () => {
    it("builds a status listing every mock file", () => {
        const status = makeMockGitStatus();

        expect(status.files.map((f) => f.path)).toEqual(MockGitFiles.map((f) => f.status.path));
        expect(status.notrepo).toBeFalsy();
    });

    it("encodes file contents for the diff rpc response", () => {
        const rtn = makeMockGitFileDiff("src/lib/greeting.ts");

        expect(base64ToString(rtn.originalcontents64)).toBe(MockGitFiles[0].original);
        expect(base64ToString(rtn.modifiedcontents64)).toBe(MockGitFiles[0].modified);
    });

    it("flags binary files without contents", () => {
        const rtn = makeMockGitFileDiff("assets/logo.png");

        expect(rtn.binary).toBe(true);
        expect(rtn.modifiedcontents64).toBe("");
    });
});

describe("gitdiff util", () => {
    it("treats diffs as different when contents change even if stats would not", () => {
        const base = { path: "a.ts", loading: false, original: "a\nb\n", modified: "a\nB\n" };

        expect(isSameFileDiff(base, { ...base })).toBe(true);
        expect(isSameFileDiff(base, { ...base, modified: "a\nC\n" })).toBe(false);
        expect(isSameFileDiff(base, { ...base, path: "b.ts" })).toBe(false);
        expect(isSameFileDiff(base, null)).toBe(false);
        expect(isSameFileDiff(null, null)).toBe(true);
    });

    it("detects unknown-command errors from an outdated wsh", () => {
        expect(isWshOutdatedError('command "remotegitstatus" not found')).toBe(true);
        expect(isWshOutdatedError("git status: fatal: bad object")).toBe(false);
        expect(isWshOutdatedError(null)).toBe(false);
    });

    it("splits repo paths into dir and name", () => {
        expect(splitRepoPath("src/lib/a.ts")).toEqual({ dir: "src/lib", name: "a.ts" });
        expect(splitRepoPath("a.ts")).toEqual({ dir: "", name: "a.ts" });
    });
});
