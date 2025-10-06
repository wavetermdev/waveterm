// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, describe, test } from "vitest";
import {
    generateAutoTitle,
    getEffectiveTitle,
    shouldAutoGenerateTitle,
} from "./autotitle";

describe("generateAutoTitle", () => {
    test("generates terminal title from cwd", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "term",
                "term:cwd": "/home/user/projects/myapp",
            },
        };
        const title = generateAutoTitle(block);
        assert.equal(title, "myapp");
    });

    test("generates terminal title with last command", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "term",
                "term:cwd": "/home/user/projects",
                "term:lastcmd": "npm run dev",
            },
        };
        const title = generateAutoTitle(block);
        assert.equal(title, "projects: npm run dev");
    });

    test("generates terminal title with long command truncated", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "term",
                "term:lastcmd": "this is a very long command that should be truncated at thirty chars",
            },
        };
        const title = generateAutoTitle(block);
        assert.equal(title, "this is a very long command th...");
    });

    test("generates preview title from filename", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "preview",
                file: "/docs/README.md",
            },
        };
        const title = generateAutoTitle(block);
        assert.equal(title, "README.md");
    });

    test("generates preview title from URL", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "preview",
                url: "https://example.com/page.html",
            },
        };
        const title = generateAutoTitle(block);
        assert.equal(title, "example.com");
    });

    test("generates editor title with parent directory", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "codeeditor",
                file: "/home/user/projects/src/index.ts",
            },
        };
        const title = generateAutoTitle(block);
        assert.equal(title, "src/index.ts");
    });

    test("generates editor title for short path", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "codeeditor",
                file: "index.ts",
            },
        };
        const title = generateAutoTitle(block);
        assert.equal(title, "index.ts");
    });

    test("generates chat title with channel", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "chat",
                "chat:channel": "general",
            },
        };
        const title = generateAutoTitle(block);
        assert.equal(title, "Chat: general");
    });

    test("generates default title for help view", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "help",
            },
        };
        const title = generateAutoTitle(block);
        assert.equal(title, "Help");
    });

    test("generates default title for unknown view", () => {
        const block: Block = {
            oid: "test-abcd1234",
            version: 1,
            meta: {
                view: "unknownview",
            },
        };
        const title = generateAutoTitle(block);
        assert.equal(title, "Unknownview (test-abc)");
    });

    test("handles null or empty block gracefully", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {},
        };
        const title = generateAutoTitle(block);
        assert.equal(title, "Block (test-123)");
    });
});

describe("shouldAutoGenerateTitle", () => {
    test("returns false when block has custom title", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "term",
                "pane-title": "My Custom Title",
            },
        };
        const result = shouldAutoGenerateTitle(block);
        assert.equal(result, false);
    });

    test("returns true when block has no custom title", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "term",
            },
        };
        const result = shouldAutoGenerateTitle(block);
        assert.equal(result, true);
    });

    test("respects explicit auto-generate flag (true)", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "term",
                "pane-title": "Custom",
                "pane-title:auto": true,
            },
        };
        const result = shouldAutoGenerateTitle(block);
        assert.equal(result, true);
    });

    test("respects explicit auto-generate flag (false)", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "term",
                "pane-title:auto": false,
            },
        };
        const result = shouldAutoGenerateTitle(block);
        assert.equal(result, false);
    });

    test("handles null block safely", () => {
        const block: any = null;
        const result = shouldAutoGenerateTitle(block);
        assert.equal(result, false);
    });
});

describe("getEffectiveTitle", () => {
    test("returns custom title when set", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "term",
                "pane-title": "My Terminal",
                "term:cwd": "/home/user",
            },
        };
        const title = getEffectiveTitle(block, true);
        assert.equal(title, "My Terminal");
    });

    test("returns auto-generated title when no custom title", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "preview",
                file: "README.md",
            },
        };
        const title = getEffectiveTitle(block, true);
        assert.equal(title, "README.md");
    });

    test("returns empty string when auto-generate disabled", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "term",
                "term:cwd": "/home/user",
            },
        };
        const title = getEffectiveTitle(block, false);
        assert.equal(title, "");
    });

    test("prefers custom title even when auto-generate enabled", () => {
        const block: Block = {
            oid: "test-123",
            version: 1,
            meta: {
                view: "term",
                "pane-title": "Custom",
                "term:cwd": "/home/user",
            },
        };
        const title = getEffectiveTitle(block, true);
        assert.equal(title, "Custom");
    });

    test("handles null block safely", () => {
        const block: any = null;
        const title = getEffectiveTitle(block, true);
        assert.equal(title, "");
    });
});
