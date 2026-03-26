// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { arrayToBase64 } from "@/util/util";

const MockHomePath = "/Users/mike";
const MockDirMimeType = "directory";
const MockDirMode = 0o040755;
const MockFileMode = 0o100644;
const MockDirectoryChunkSize = 128;
const MockBaseModTime = Date.parse("2026-03-10T09:00:00.000Z");
const TinyPngBytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04, 0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c, 0x02, 0x00, 0x00, 0x00, 0x0b, 0x49,
    0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0x1f, 0x00, 0x03, 0x03, 0x01, 0xff, 0xa5, 0xf8, 0x8f, 0xb1, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const TinyJpegBytes = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x03, 0x02, 0x02, 0x03, 0x02, 0x02, 0x03, 0x03, 0x03, 0x03, 0x04, 0x03, 0x03,
    0x04, 0x05, 0x08, 0x05, 0x05, 0x04, 0x04, 0x05, 0x0a, 0x07, 0x07, 0x06, 0x08, 0x0c, 0x0a, 0x0c, 0x0c, 0x0b, 0x0a,
    0x0b, 0x0b, 0x0d, 0x0e, 0x12, 0x10, 0x0d, 0x0e, 0x11, 0x0e, 0x0b, 0x0b, 0x10, 0x16, 0x10, 0x11, 0x13, 0x14, 0x15,
    0x15, 0x15, 0x0c, 0x0f, 0x17, 0x18, 0x16, 0x14, 0x18, 0x12, 0x14, 0x15, 0x14, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00,
    0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01,
    0x00, 0x00, 0x3f, 0x00, 0xbf, 0xff, 0xd9,
]);

type MockFsEntry = {
    path: string;
    dir: string;
    name: string;
    isdir: boolean;
    mimetype: string;
    modtime: number;
    mode: number;
    size: number;
    readonly?: boolean;
    supportsmkdir?: boolean;
    content?: Uint8Array;
};

type MockFsEntryInput = {
    path: string;
    isdir?: boolean;
    mimetype?: string;
    readonly?: boolean;
    content?: string | Uint8Array;
};

export type MockFilesystem = {
    homePath: string;
    fileCount: number;
    directoryCount: number;
    entryCount: number;
    fileInfo: (data: FileData) => Promise<FileInfo>;
    fileRead: (data: FileData) => Promise<FileData>;
    fileList: (data: FileListData) => Promise<FileInfo[]>;
    fileJoin: (paths: string[]) => Promise<FileInfo>;
    fileListStream: (data: FileListData) => AsyncGenerator<CommandRemoteListEntriesRtnData, void, boolean>;
};

function normalizeMockPath(path: string, basePath = MockHomePath): string {
    if (path == null || path === "") {
        return basePath;
    }
    if (path.startsWith("wsh://")) {
        const url = new URL(path);
        path = url.pathname.replace(/^\/+/, "/");
    }
    if (path === "~") {
        path = MockHomePath;
    } else if (path.startsWith("~/")) {
        path = MockHomePath + path.slice(1);
    }
    if (!path.startsWith("/")) {
        path = `${basePath}/${path}`;
    }
    const parts = path.split("/");
    const resolvedParts: string[] = [];
    for (const part of parts) {
        if (!part || part === ".") {
            continue;
        }
        if (part === "..") {
            resolvedParts.pop();
            continue;
        }
        resolvedParts.push(part);
    }
    const resolvedPath = "/" + resolvedParts.join("/");
    return resolvedPath === "" ? "/" : resolvedPath;
}

function getDirName(path: string): string {
    if (path === "/") {
        return "/";
    }
    const idx = path.lastIndexOf("/");
    if (idx <= 0) {
        return "/";
    }
    return path.slice(0, idx);
}

function getBaseName(path: string): string {
    if (path === "/") {
        return "/";
    }
    const idx = path.lastIndexOf("/");
    return idx < 0 ? path : path.slice(idx + 1);
}

function getMimeType(path: string, isdir: boolean): string {
    if (isdir) {
        return MockDirMimeType;
    }
    if (path.endsWith(".md")) {
        return "text/markdown";
    }
    if (path.endsWith(".json")) {
        return "application/json";
    }
    if (path.endsWith(".ts")) {
        return "text/typescript";
    }
    if (path.endsWith(".tsx")) {
        return "text/tsx";
    }
    if (path.endsWith(".js")) {
        return "text/javascript";
    }
    if (path.endsWith(".txt") || path.endsWith(".log") || path.endsWith(".bashrc") || path.endsWith(".zprofile")) {
        return "text/plain";
    }
    if (path.endsWith(".png")) {
        return "image/png";
    }
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) {
        return "image/jpeg";
    }
    if (path.endsWith(".pdf")) {
        return "application/pdf";
    }
    if (path.endsWith(".zip")) {
        return "application/zip";
    }
    if (path.endsWith(".dmg")) {
        return "application/x-apple-diskimage";
    }
    if (path.endsWith(".svg")) {
        return "image/svg+xml";
    }
    if (path.endsWith(".yaml") || path.endsWith(".yml")) {
        return "application/yaml";
    }
    return "application/octet-stream";
}

function makeContentBytes(content: string | Uint8Array): Uint8Array {
    if (content instanceof Uint8Array) {
        return content;
    }
    return new TextEncoder().encode(content);
}

function makeMockFsInput(path: string, content?: string | Uint8Array, mimetype?: string): MockFsEntryInput {
    return { path, content, mimetype };
}

function createMockFilesystemEntries(): MockFsEntryInput[] {
    const entries: MockFsEntryInput[] = [
        { path: "/", isdir: true },
        { path: "/Users", isdir: true },
        { path: MockHomePath, isdir: true },
        { path: `${MockHomePath}/Desktop`, isdir: true },
        { path: `${MockHomePath}/Documents`, isdir: true },
        { path: `${MockHomePath}/Downloads`, isdir: true },
        { path: `${MockHomePath}/Pictures`, isdir: true },
        { path: `${MockHomePath}/Projects`, isdir: true },
        { path: `${MockHomePath}/waveterm`, isdir: true },
        { path: `${MockHomePath}/waveterm/docs`, isdir: true },
        { path: `${MockHomePath}/waveterm/images`, isdir: true },
        { path: `${MockHomePath}/.config`, isdir: true },
        makeMockFsInput(
            `${MockHomePath}/.bashrc`,
            `export PATH="$HOME/bin:$PATH"\nalias gs="git status -sb"\nexport WAVETERM_THEME="midnight"\n`,
            "text/plain"
        ),
        makeMockFsInput(`${MockHomePath}/.gitconfig`),
        makeMockFsInput(`${MockHomePath}/.zprofile`),
        makeMockFsInput(`${MockHomePath}/todo.txt`),
        makeMockFsInput(`${MockHomePath}/notes.txt`),
        makeMockFsInput(`${MockHomePath}/shell-aliases`),
        makeMockFsInput(`${MockHomePath}/archive.log`),
        makeMockFsInput(`${MockHomePath}/session.txt`),
        makeMockFsInput(`${MockHomePath}/Desktop/launch-plan.md`),
        makeMockFsInput(`${MockHomePath}/Desktop/coffee.txt`),
        makeMockFsInput(`${MockHomePath}/Desktop/daily-standup.txt`),
        makeMockFsInput(`${MockHomePath}/Desktop/snippets.txt`),
        makeMockFsInput(`${MockHomePath}/Desktop/terminal-theme.png`),
        makeMockFsInput(`${MockHomePath}/Desktop/macos-shortcuts.txt`),
        makeMockFsInput(`${MockHomePath}/Desktop/bug-scrub.txt`),
        makeMockFsInput(`${MockHomePath}/Desktop/parking-receipt.pdf`),
        makeMockFsInput(`${MockHomePath}/Desktop/demo-script.md`),
        makeMockFsInput(`${MockHomePath}/Desktop/roadmap-draft.txt`),
        makeMockFsInput(`${MockHomePath}/Desktop/pairing-notes.txt`),
        makeMockFsInput(`${MockHomePath}/Desktop/wave-window.jpg`),
        makeMockFsInput(
            `${MockHomePath}/Documents/meeting-notes.md`,
            `# File Preview Notes\n\n- Build a richer preview mock environment.\n- Add a fake filesystem rooted at \`${MockHomePath}\`.\n- Make markdown previews resolve relative assets.\n`,
            "text/markdown"
        ),
        makeMockFsInput(`${MockHomePath}/Documents/architecture-overview.md`),
        makeMockFsInput(`${MockHomePath}/Documents/release-checklist.md`),
        makeMockFsInput(`${MockHomePath}/Documents/ideas.txt`),
        makeMockFsInput(`${MockHomePath}/Documents/customer-feedback.txt`),
        makeMockFsInput(`${MockHomePath}/Documents/cli-ux-notes.txt`),
        makeMockFsInput(`${MockHomePath}/Documents/migration-plan.md`),
        makeMockFsInput(`${MockHomePath}/Documents/design-review.md`),
        makeMockFsInput(`${MockHomePath}/Documents/ops-runbook.md`),
        makeMockFsInput(`${MockHomePath}/Documents/troubleshooting.txt`),
        makeMockFsInput(`${MockHomePath}/Documents/preview-fixtures.txt`),
        makeMockFsInput(`${MockHomePath}/Documents/backlog.txt`),
        makeMockFsInput(`${MockHomePath}/Documents/feature-flags.yaml`),
        makeMockFsInput(`${MockHomePath}/Documents/connections.csv`),
        makeMockFsInput(`${MockHomePath}/Documents/ssh-hosts.txt`),
        makeMockFsInput(`${MockHomePath}/Documents/notes-2026-03-01.md`),
        makeMockFsInput(`${MockHomePath}/Documents/notes-2026-03-05.md`),
        makeMockFsInput(`${MockHomePath}/Documents/notes-2026-03-09.md`),
        makeMockFsInput(`${MockHomePath}/Downloads/waveterm-nightly.dmg`),
        makeMockFsInput(`${MockHomePath}/Downloads/screenshot-pack.zip`),
        makeMockFsInput(`${MockHomePath}/Downloads/cli-reference.pdf`),
        makeMockFsInput(`${MockHomePath}/Downloads/ssh-cheatsheet.pdf`),
        makeMockFsInput(`${MockHomePath}/Downloads/perf-trace.json`),
        makeMockFsInput(`${MockHomePath}/Downloads/terminal-icons.zip`),
        makeMockFsInput(`${MockHomePath}/Downloads/demo-data.csv`),
        makeMockFsInput(`${MockHomePath}/Downloads/deploy-plan.txt`),
        makeMockFsInput(`${MockHomePath}/Downloads/customer-audio.m4a`),
        makeMockFsInput(`${MockHomePath}/Downloads/mock-shell-history.txt`),
        makeMockFsInput(`${MockHomePath}/Downloads/design-assets.zip`),
        makeMockFsInput(`${MockHomePath}/Downloads/old-preview-build.dmg`),
        makeMockFsInput(`${MockHomePath}/Downloads/testing-samples.tar`),
        makeMockFsInput(`${MockHomePath}/Downloads/workflow-failure.log`),
        makeMockFsInput(`${MockHomePath}/Downloads/team-photo.jpg`),
        makeMockFsInput(`${MockHomePath}/Downloads/preview-recording.mov`),
        makeMockFsInput(`${MockHomePath}/Downloads/standup-notes.txt`),
        makeMockFsInput(`${MockHomePath}/Downloads/metadata.json`),
        makeMockFsInput(`${MockHomePath}/Pictures/beach-sunrise.png`, TinyPngBytes, "image/png"),
        makeMockFsInput(`${MockHomePath}/Pictures/terminal-screenshot.jpg`, TinyJpegBytes, "image/jpeg"),
        makeMockFsInput(`${MockHomePath}/Pictures/diagram.png`),
        makeMockFsInput(`${MockHomePath}/Pictures/launch-party.jpg`),
        makeMockFsInput(`${MockHomePath}/Pictures/icon-sketch.png`),
        makeMockFsInput(`${MockHomePath}/Pictures/backgrounds-01.png`),
        makeMockFsInput(`${MockHomePath}/Pictures/backgrounds-02.png`),
        makeMockFsInput(`${MockHomePath}/Pictures/backgrounds-03.png`),
        makeMockFsInput(`${MockHomePath}/Pictures/backgrounds-04.png`),
        makeMockFsInput(`${MockHomePath}/Pictures/backgrounds-05.png`),
        makeMockFsInput(`${MockHomePath}/Pictures/product-shot-01.jpg`),
        makeMockFsInput(`${MockHomePath}/Pictures/product-shot-02.jpg`),
        makeMockFsInput(`${MockHomePath}/Pictures/product-shot-03.jpg`),
        makeMockFsInput(`${MockHomePath}/Pictures/product-shot-04.jpg`),
        makeMockFsInput(`${MockHomePath}/Pictures/product-shot-05.jpg`),
        makeMockFsInput(`${MockHomePath}/Pictures/ui-concept.png`),
        makeMockFsInput(`${MockHomePath}/Projects/local.env`),
        makeMockFsInput(`${MockHomePath}/Projects/db-migration.sql`),
        makeMockFsInput(`${MockHomePath}/Projects/prompt-lab.txt`),
        makeMockFsInput(`${MockHomePath}/Projects/ui-spikes.tsx`),
        makeMockFsInput(`${MockHomePath}/Projects/file-browser.tsx`),
        makeMockFsInput(`${MockHomePath}/Projects/mock-data.json`),
        makeMockFsInput(`${MockHomePath}/Projects/preview-api.ts`),
        makeMockFsInput(`${MockHomePath}/Projects/bug-181.txt`),
        makeMockFsInput(
            `${MockHomePath}/waveterm/README.md`,
            `# Mock WaveTerm Repo\n\nThis fake repo exists only in the preview environment.\nIt gives file previews something realistic to browse.\n`,
            "text/markdown"
        ),
        makeMockFsInput(`${MockHomePath}/waveterm/package.json`),
        makeMockFsInput(`${MockHomePath}/waveterm/tsconfig.json`),
        makeMockFsInput(`${MockHomePath}/waveterm/Taskfile.yml`),
        makeMockFsInput(`${MockHomePath}/waveterm/preview-model.tsx`),
        makeMockFsInput(`${MockHomePath}/waveterm/mockwaveenv.ts`),
        makeMockFsInput(`${MockHomePath}/waveterm/vite.config.ts`),
        makeMockFsInput(`${MockHomePath}/waveterm/CHANGELOG.md`),
        makeMockFsInput(
            `${MockHomePath}/waveterm/docs/preview-notes.md`,
            `# Preview Mocking\n\nUse the preview server to iterate on file previews without Electron.\nRelative markdown assets should resolve through \`FileJoinCommand\`.\n`,
            "text/markdown"
        ),
        makeMockFsInput(`${MockHomePath}/waveterm/docs/filesystem-rpc.md`),
        makeMockFsInput(`${MockHomePath}/waveterm/docs/test-plan.md`),
        makeMockFsInput(`${MockHomePath}/waveterm/docs/connections.md`),
        makeMockFsInput(`${MockHomePath}/waveterm/docs/preview-gallery.md`),
        makeMockFsInput(`${MockHomePath}/waveterm/docs/release-notes.md`),
        makeMockFsInput(`${MockHomePath}/waveterm/images/wave-logo.png`, TinyPngBytes, "image/png"),
        makeMockFsInput(`${MockHomePath}/waveterm/images/hero.png`),
        makeMockFsInput(`${MockHomePath}/waveterm/images/avatar.jpg`),
        makeMockFsInput(`${MockHomePath}/waveterm/images/icon-16.png`),
        makeMockFsInput(`${MockHomePath}/waveterm/images/icon-32.png`),
        makeMockFsInput(`${MockHomePath}/waveterm/images/splash.jpg`),
        makeMockFsInput(
            `${MockHomePath}/.config/settings.json`,
            JSON.stringify(
                {
                    "app:theme": "wave-dark",
                    "preview:lastpath": `${MockHomePath}/Documents/meeting-notes.md`,
                    "window:magnifiedblockopacity": 0.92,
                },
                null,
                2
            ),
            "application/json"
        ),
        makeMockFsInput(`${MockHomePath}/.config/preview-cache.json`),
        makeMockFsInput(`${MockHomePath}/.config/recent-workspaces.json`),
        makeMockFsInput(`${MockHomePath}/.config/telemetry.log`),
    ];
    return entries;
}

function buildEntries(): Map<string, MockFsEntry> {
    const inputs = createMockFilesystemEntries();
    const entries = new Map<string, MockFsEntry>();
    const ensureDir = (path: string) => {
        const normalizedPath = normalizeMockPath(path, "/");
        if (entries.has(normalizedPath)) {
            return;
        }
        const dir = getDirName(normalizedPath);
        if (normalizedPath !== "/") {
            ensureDir(dir);
        }
        entries.set(normalizedPath, {
            path: normalizedPath,
            dir: normalizedPath === "/" ? "/" : dir,
            name: normalizedPath === "/" ? "/" : getBaseName(normalizedPath),
            isdir: true,
            mimetype: MockDirMimeType,
            modtime: MockBaseModTime + entries.size * 60000,
            mode: MockDirMode,
            size: 0,
            supportsmkdir: true,
        });
    };
    for (const input of inputs) {
        const normalizedPath = normalizeMockPath(input.path, "/");
        const isdir = input.isdir ?? false;
        const dir = getDirName(normalizedPath);
        if (normalizedPath !== "/") {
            ensureDir(dir);
        }
        const content = input.content == null ? undefined : makeContentBytes(input.content);
        entries.set(normalizedPath, {
            path: normalizedPath,
            dir: normalizedPath === "/" ? "/" : dir,
            name: normalizedPath === "/" ? "/" : getBaseName(normalizedPath),
            isdir,
            mimetype: input.mimetype ?? getMimeType(normalizedPath, isdir),
            modtime: MockBaseModTime + entries.size * 60000,
            mode: isdir ? MockDirMode : MockFileMode,
            size: content?.byteLength ?? 0,
            readonly: input.readonly,
            supportsmkdir: isdir,
            content,
        });
    }
    return entries;
}

function toFileInfo(entry: MockFsEntry): FileInfo {
    return {
        path: entry.path,
        dir: entry.dir,
        name: entry.name,
        size: entry.size,
        mode: entry.mode,
        modtime: entry.modtime,
        isdir: entry.isdir,
        supportsmkdir: entry.supportsmkdir,
        mimetype: entry.mimetype,
        readonly: entry.readonly,
    };
}

function makeNotFoundInfo(path: string): FileInfo {
    const normalizedPath = normalizeMockPath(path);
    return {
        path: normalizedPath,
        dir: getDirName(normalizedPath),
        name: getBaseName(normalizedPath),
        notfound: true,
        supportsmkdir: true,
    };
}

function sliceEntries(entries: FileInfo[], opts?: FileListOpts): FileInfo[] {
    let filteredEntries = entries;
    if (!opts?.all) {
        filteredEntries = filteredEntries.filter((entry) => entry.name != null && !entry.name.startsWith("."));
    }
    const offset = Math.max(opts?.offset ?? 0, 0);
    const end = opts?.limit != null && opts.limit >= 0 ? offset + opts.limit : undefined;
    return filteredEntries.slice(offset, end);
}

function joinPaths(paths: string[]): string {
    if (paths.length === 0) {
        return MockHomePath;
    }
    let currentPath = normalizeMockPath(paths[0]);
    for (const part of paths.slice(1)) {
        currentPath = normalizeMockPath(part, currentPath);
    }
    return currentPath;
}

function getReadRange(data: FileData, size: number): { offset: number; end: number } {
    const offset = Math.max(data?.at?.offset ?? 0, 0);
    const end = data?.at?.size != null ? Math.min(offset + data.at.size, size) : size;
    return { offset, end: Math.max(offset, end) };
}

export function makeMockFilesystem(): MockFilesystem {
    const entries = buildEntries();
    const childrenByDir = new Map<string, MockFsEntry[]>();
    for (const entry of entries.values()) {
        if (entry.path === "/") {
            continue;
        }
        if (!childrenByDir.has(entry.dir)) {
            childrenByDir.set(entry.dir, []);
        }
        childrenByDir.get(entry.dir).push(entry);
    }
    for (const childEntries of childrenByDir.values()) {
        childEntries.sort((a, b) => {
            if (a.isdir !== b.isdir) {
                return a.isdir ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
    }
    const getEntry = (path: string): MockFsEntry => {
        return entries.get(normalizeMockPath(path));
    };
    const fileInfo = async (data: FileData): Promise<FileInfo> => {
        const entry = getEntry(data?.info?.path ?? MockHomePath);
        if (!entry) {
            return makeNotFoundInfo(data?.info?.path ?? MockHomePath);
        }
        return toFileInfo(entry);
    };
    const fileRead = async (data: FileData): Promise<FileData> => {
        const info = await fileInfo(data);
        if (info.notfound) {
            return { info };
        }
        const entry = getEntry(info.path);
        if (entry.isdir) {
            const childEntries = (childrenByDir.get(entry.path) ?? []).map((child) => toFileInfo(child));
            return { info, entries: childEntries };
        }
        if (entry.content == null || entry.content.byteLength === 0) {
            return { info };
        }
        const { offset, end } = getReadRange(data, entry.content.byteLength);
        return {
            info,
            data64: arrayToBase64(entry.content.slice(offset, end)),
            at: { offset, size: end - offset },
        };
    };
    const fileList = async (data: FileListData): Promise<FileInfo[]> => {
        const dirPath = normalizeMockPath(data?.path ?? MockHomePath);
        const entry = getEntry(dirPath);
        if (entry == null || !entry.isdir) {
            return [];
        }
        const dirEntries = (childrenByDir.get(dirPath) ?? []).map((child) => toFileInfo(child));
        return sliceEntries(dirEntries, data?.opts);
    };
    const fileJoin = async (paths: string[]): Promise<FileInfo> => {
        const path = paths.length === 1 ? normalizeMockPath(paths[0]) : joinPaths(paths);
        const entry = getEntry(path);
        if (!entry) {
            return makeNotFoundInfo(path);
        }
        return toFileInfo(entry);
    };
    const fileListStream = async function* (
        data: FileListData
    ): AsyncGenerator<CommandRemoteListEntriesRtnData, void, boolean> {
        const fileInfos = await fileList(data);
        for (let idx = 0; idx < fileInfos.length; idx += MockDirectoryChunkSize) {
            yield { fileinfo: fileInfos.slice(idx, idx + MockDirectoryChunkSize) };
        }
    };
    const fileCount = Array.from(entries.values()).filter((entry) => !entry.isdir).length;
    const directoryCount = Array.from(entries.values()).filter((entry) => entry.isdir).length;
    return {
        homePath: MockHomePath,
        fileCount,
        directoryCount,
        entryCount: entries.size,
        fileInfo,
        fileRead,
        fileList,
        fileJoin,
        fileListStream,
    };
}

export const DefaultMockFilesystem = makeMockFilesystem();
