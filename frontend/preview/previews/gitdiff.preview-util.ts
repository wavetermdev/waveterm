// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { stringToBase64 } from "@/util/util";

export const DefaultGitDiffCwd = "/home/user/projects/greeter";

type MockGitFile = {
    status: GitFileStatus;
    original: string;
    modified: string;
    binary?: boolean;
};

export const MockGitFiles: MockGitFile[] = [
    {
        status: { path: "src/lib/greeting.ts", status: "modified", additions: 2, deletions: 1 },
        original: `export function greet(name: string) {
    return "Hello " + name;
}
`,
        modified: `export function greet(name: string) {
    const normalizedName = name.trim() || "friend";
    return \`Hello, \${normalizedName}!\`;
}
`,
    },
    {
        status: { path: "src/lib/farewell.ts", status: "added", staged: true, additions: 3 },
        original: "",
        modified: `export function farewell(name: string) {
    return \`Goodbye, \${name}!\`;
}
`,
    },
    {
        status: { path: "docs/OLD_NOTES.md", status: "deleted", deletions: 2 },
        original: "# Notes\n\nTo be removed.\n",
        modified: "",
    },
    {
        status: { path: "src/main.go", origpath: "main.go", status: "renamed", staged: true, additions: 1, deletions: 1 },
        original: 'package main\n\nfunc main() {\n\tprintln("hi")\n}\n',
        modified: 'package main\n\nfunc main() {\n\tprintln("hello")\n}\n',
    },
    {
        status: { path: "scratch.py", status: "untracked", additions: 2 },
        original: "",
        modified: 'print("scratch")\nprint("done")\n',
    },
    {
        status: { path: "assets/logo.png", status: "modified", binary: true },
        original: "",
        modified: "",
        binary: true,
    },
];

export function makeMockGitStatus(files: MockGitFile[] = MockGitFiles): GitStatusRtnData {
    return {
        reporoot: DefaultGitDiffCwd,
        branch: "feature/greetings",
        hashead: true,
        files: files.map((f) => f.status),
    };
}

export function makeMockGitFileDiff(path: string, files: MockGitFile[] = MockGitFiles): GitFileDiffRtnData {
    const file = files.find((f) => f.status.path === path);
    if (file == null) {
        throw new Error(`file not found: ${path}`);
    }
    if (file.binary) {
        return { originalcontents64: "", modifiedcontents64: "", binary: true };
    }
    return {
        originalcontents64: stringToBase64(file.original),
        modifiedcontents64: stringToBase64(file.modified),
    };
}
