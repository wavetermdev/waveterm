// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { DefaultMockFilesystem } from "./mockfilesystem";

const MaxMockSuggestions = 50;

type ResolvedMockFileQuery = {
    baseDir: string;
    queryPrefix: string;
    searchTerm: string;
};

function ensureTrailingSlash(path: string): string {
    if (path === "" || path.endsWith("/")) {
        return path;
    }
    return path + "/";
}

function trimTrailingSlash(path: string): string {
    if (path === "/") {
        return path;
    }
    return path.replace(/\/+$/, "");
}

function getDirName(path: string): string {
    const trimmedPath = trimTrailingSlash(path);
    if (trimmedPath === "/") {
        return "/";
    }
    const idx = trimmedPath.lastIndexOf("/");
    if (idx <= 0) {
        return "/";
    }
    return trimmedPath.slice(0, idx);
}

function getBaseName(path: string): string {
    const trimmedPath = trimTrailingSlash(path);
    if (trimmedPath === "/") {
        return "/";
    }
    const idx = trimmedPath.lastIndexOf("/");
    return idx < 0 ? trimmedPath : trimmedPath.slice(idx + 1);
}

function expandMockHome(path: string): string {
    if (path === "~") {
        return DefaultMockFilesystem.homePath;
    }
    if (path.startsWith("~/")) {
        return DefaultMockFilesystem.homePath + path.slice(1);
    }
    return path;
}

function normalizeMockPath(path: string, basePath = DefaultMockFilesystem.homePath): string {
    if (path == null || path === "") {
        return basePath;
    }
    path = expandMockHome(path);
    if (!path.startsWith("/")) {
        path = `${basePath}/${path}`;
    }
    const resolvedParts: string[] = [];
    for (const part of path.split("/")) {
        if (part === "" || part === ".") {
            continue;
        }
        if (part === "..") {
            resolvedParts.pop();
            continue;
        }
        resolvedParts.push(part);
    }
    return "/" + resolvedParts.join("/");
}

function resolveMockFileQuery(cwd: string, query: string): ResolvedMockFileQuery {
    const resolvedCwd = normalizeMockPath(cwd || "~", "/");
    if (query == null || query === "") {
        return { baseDir: resolvedCwd, queryPrefix: "", searchTerm: "" };
    }
    if (query === "~" || query === "~/") {
        return { baseDir: DefaultMockFilesystem.homePath, queryPrefix: "~/", searchTerm: "" };
    }
    const expandedQuery = expandMockHome(query);
    if (expandedQuery.startsWith("/")) {
        if (query.endsWith("/")) {
            return {
                baseDir: normalizeMockPath(expandedQuery, "/"),
                queryPrefix: query,
                searchTerm: "",
            };
        }
        if (expandedQuery === "/") {
            return { baseDir: "/", queryPrefix: "/", searchTerm: "" };
        }
        return {
            baseDir: getDirName(expandedQuery),
            queryPrefix: ensureTrailingSlash(getDirName(query)),
            searchTerm: getBaseName(expandedQuery),
        };
    }
    if (query.endsWith("/")) {
        return {
            baseDir: normalizeMockPath(query, resolvedCwd),
            queryPrefix: query,
            searchTerm: "",
        };
    }
    const slashIdx = query.lastIndexOf("/");
    if (slashIdx !== -1) {
        const dirPart = query.slice(0, slashIdx);
        return {
            baseDir: normalizeMockPath(dirPart, resolvedCwd),
            queryPrefix: ensureTrailingSlash(dirPart),
            searchTerm: query.slice(slashIdx + 1),
        };
    }
    return { baseDir: resolvedCwd, queryPrefix: "", searchTerm: query };
}

function findMatchPositions(value: string, searchTerm: string): number[] {
    const lowerValue = value.toLowerCase();
    const lowerSearchTerm = searchTerm.toLowerCase();
    const positions: number[] = [];
    let searchIdx = 0;
    for (let idx = 0; idx < lowerValue.length; idx++) {
        if (lowerValue[idx] !== lowerSearchTerm[searchIdx]) {
            continue;
        }
        positions.push(idx);
        searchIdx++;
        if (searchIdx >= lowerSearchTerm.length) {
            return positions;
        }
    }
    return null;
}

function scoreSuggestion(value: string, positions: number[], fallbackIndex: number): number {
    if (positions.length === 0) {
        return MaxMockSuggestions - fallbackIndex;
    }
    let score = 1000 - value.length;
    if (positions[0] === 0) {
        score += 500;
    }
    for (let idx = 1; idx < positions.length; idx++) {
        if (positions[idx] === positions[idx - 1] + 1) {
            score += 25;
        }
    }
    return score;
}

export async function fetchMockSuggestions(data: FetchSuggestionsData): Promise<FetchSuggestionsResponse> {
    if (data?.suggestiontype !== "file") {
        return { reqnum: data?.reqnum ?? 0, suggestions: [] };
    }
    const { baseDir, queryPrefix, searchTerm } = resolveMockFileQuery(data?.["file:cwd"], data?.query ?? "");
    const fileInfos = await DefaultMockFilesystem.fileList({
        path: baseDir,
        opts: { all: true, limit: MaxMockSuggestions * 4 },
    });
    const suggestions = fileInfos
        .map((fileInfo, idx) => {
            if (data?.["file:dironly"] && !fileInfo.isdir) {
                return null;
            }
            const suggestionName = `${queryPrefix}${fileInfo.name}`;
            const matchpos = searchTerm === "" ? [] : findMatchPositions(suggestionName, searchTerm);
            if (searchTerm !== "" && matchpos == null) {
                return null;
            }
            return {
                type: "file",
                suggestionid: fileInfo.path,
                display: suggestionName,
                "file:path": fileInfo.path,
                "file:name": suggestionName,
                "file:mimetype": fileInfo.mimetype,
                matchpos,
                score: scoreSuggestion(suggestionName, matchpos ?? [], idx),
            } satisfies SuggestionType;
        })
        .filter((suggestion): suggestion is SuggestionType => suggestion != null);
    suggestions.sort((a, b) => {
        if ((a.score ?? 0) !== (b.score ?? 0)) {
            return (b.score ?? 0) - (a.score ?? 0);
        }
        return a.display.length - b.display.length;
    });
    return {
        reqnum: data?.reqnum ?? 0,
        suggestions: suggestions.slice(0, MaxMockSuggestions),
    };
}
