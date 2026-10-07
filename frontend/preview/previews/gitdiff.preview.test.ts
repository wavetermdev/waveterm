// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getFileSignature, isWshOutdatedError, splitRepoPath } from "@/app/view/gitdiff/gitdiff-util";
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
    it("changes the signature when stats or status change", () => {
        const base: GitFileStatus = { path: "a.ts", status: "modified", additions: 1, deletions: 0 };

        expect(getFileSignature(base)).toBe(getFileSignature({ ...base }));
        expect(getFileSignature(base)).not.toBe(getFileSignature({ ...base, additions: 2 }));
        expect(getFileSignature(base)).not.toBe(getFileSignature({ ...base, status: "deleted" }));
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
