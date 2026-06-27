// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { globalStore } from "@/app/store/jotaiStore";
import type { TabModel } from "@/app/store/tab-model";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getBlockComponentModel, refocusNode, createBlockSplitVertically } from "@/store/global";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { walkNodes } from "@/layout/lib/layoutNode";
import * as WOS from "@/store/wos";
import { WaveEnv } from "@/app/waveenv/waveenv";
import { formatRemoteUri } from "@/util/waveutil";
import { makeIconClass, isBlank } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import { PreviewModel } from "@/app/view/preview/preview-model";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";

// ---- Types ----

interface CommandFileSearchData {
    path: string;
    query: string;
    ignorecase: boolean;
    regex: boolean;
}

interface FileSearchMatch {
    linenum: number;
    line: string;
}

interface FileSearchResult {
    path: string;
    matches: FileSearchMatch[];
}

interface TreeFolderNode {
    id: string;
    name: string;
    path: string;
    isDirectory: true;
    children: (TreeFolderNode | TreeFileNode)[];
    matchCount: number;
}

interface TreeFileNode {
    id: string;
    name: string;
    path: string;
    isDirectory: false;
    matches: FileSearchMatch[];
    matchCount: number;
    parentPathStr?: string;
}

type SearchTreeNode = TreeFolderNode | TreeFileNode;

// ---- View Model ----

export class SearchViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    env: WaveEnv;

    viewIcon = jotai.atom<string>("search");
    viewName = jotai.atom<string>("Search");
    noPadding = jotai.atom<boolean>(true);

    blockAtom: jotai.Atom<Block>;
    connection: jotai.Atom<string>;
    searchPath: jotai.Atom<string>;

    constructor({ blockId, nodeModel, tabModel, waveEnv }: ViewModelInitType) {
        this.viewType = "search";
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.env = waveEnv;

        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.connection = jotai.atom((get) => {
            return get(this.blockAtom)?.meta?.connection ?? "";
        });
        this.searchPath = jotai.atom((get) => {
            return get(this.blockAtom)?.meta?.file ?? "~";
        });
    }

    get viewComponent(): ViewComponent {
        return SearchView;
    }
}

// ---- Helpers ----

function getFileIcon(name: string, isDirectory: boolean, isExpanded?: boolean): string {
    if (isDirectory) {
        return isExpanded ? "folder-open" : "folder";
    }
    const extension = name.split(".").pop()?.toLowerCase() ?? "";
    if (["js", "jsx", "ts", "tsx", "go", "py", "java", "c", "cpp", "h", "hpp", "json", "yaml", "yml"].includes(extension)) {
        return "file-code";
    }
    if (["md", "txt", "log"].includes(extension)) {
        return "file-lines";
    }
    return "file";
}

function getIconColor(name: string, isDirectory: boolean): string {
    if (isDirectory) {
        return "var(--color-folder, var(--term-bright-blue))";
    }
    const label = name.toLowerCase();
    if (label === "dockerfile" || label.startsWith("docker-compose")) {
        return "#0db7ed";
    }
    if (label.startsWith(".env")) {
        return "#c5c5c5";
    }
    if (label.startsWith(".git")) {
        return "#f1502f";
    }
    const extension = label.split(".").pop();
    switch (extension) {
        case "py":
            return "#3572a5";
        case "js":
        case "jsx":
            return "#f1e05a";
        case "ts":
        case "tsx":
            return "#3178c6";
        case "json":
            return "#cbcb41";
        case "yaml":
        case "yml":
            return "#cb6341";
        case "md":
        case "mdx":
            return "#0083fe";
        case "html":
            return "#e34c26";
        case "css":
        case "scss":
            return "#563d7c";
        case "go":
            return "#00add8";
        default:
            return "var(--grey-text-color, #888888)";
    }
}

function buildSearchTree(results: FileSearchResult[], searchDir: string): SearchTreeNode[] {
    const rootName = searchDir.split("/").filter(Boolean).pop() || "Root";
    
    const rootFolder: TreeFolderNode = {
        id: "search-root",
        name: rootName,
        path: searchDir,
        isDirectory: true,
        children: [],
        matchCount: 0
    };

    const fileNodes: TreeFileNode[] = [];

    for (const res of results) {
        let relPath = res.path;
        if (res.path.startsWith(searchDir)) {
            relPath = res.path.slice(searchDir.length);
            if (relPath.startsWith("/")) {
                relPath = relPath.slice(1);
            }
        } else {
            const parts = res.path.split("/");
            if (parts.length > 2) {
                relPath = parts.slice(-2).join("/");
            }
        }
        
        const parts = relPath.split("/").filter(Boolean);
        if (parts.length === 0) continue;

        const fileDirParts = parts.slice(0, -1);
        const fileName = parts[parts.length - 1];
        const parentPathStr = fileDirParts.join("/");

        fileNodes.push({
            id: res.path,
            name: fileName,
            path: res.path,
            isDirectory: false,
            matches: res.matches,
            matchCount: res.matches.length,
            parentPathStr: parentPathStr
        });
    }

    fileNodes.sort((a, b) => a.name.localeCompare(b.name));

    rootFolder.children = fileNodes;
    rootFolder.matchCount = fileNodes.reduce((sum, f) => sum + f.matchCount, 0);

    return [rootFolder];
}

// ---- React Components ----

interface SearchViewProps {
    blockId: string;
    model: SearchViewModel;
}

function SearchView({ blockId, model }: SearchViewProps) {
    const connName = jotai.useAtomValue(model.connection);
    const searchDir = jotai.useAtomValue(model.searchPath);

    const [query, setQuery] = React.useState("");
    const [matchCase, setMatchCase] = React.useState(false);
    const [useRegex, setUseRegex] = React.useState(false);

    const [results, setResults] = React.useState<FileSearchResult[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

    const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

    const handleSearch = React.useCallback(async (q: string, mc: boolean, rx: boolean) => {
        if (!q) {
            setResults([]);
            setErrorMsg(null);
            return;
        }
        setLoading(true);
        setErrorMsg(null);
        try {
            const formattedPath = formatRemoteUri(searchDir, connName);
            const data: CommandFileSearchData = {
                path: formattedPath,
                query: q,
                ignorecase: !mc,
                regex: rx,
            };
            const response = await model.env.rpc.FileSearchCommand(TabRpcClient, data);
            setResults(response ?? []);
            setExpanded({});
        } catch (e: any) {
            console.error("File search failed", e);
            setErrorMsg(e?.message ?? String(e));
        } finally {
            setLoading(false);
        }
    }, [connName, searchDir]);

    React.useEffect(() => {
        if (!query) {
            setResults([]);
            setErrorMsg(null);
            return;
        }
        const timer = setTimeout(() => {
            handleSearch(query, matchCase, useRegex);
        }, 300);
        return () => clearTimeout(timer);
    }, [query, matchCase, useRegex, handleSearch]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            handleSearch(query, matchCase, useRegex);
        } else if (e.key === "Escape") {
            model.env.rpc.SetMetaCommand(TabRpcClient, {
                oref: `block:${model.blockId}`,
                meta: {
                    view: "preview",
                    file: searchDir,
                    connection: connName,
                },
            });
        }
    };

    const toggleExpand = (id: string) => {
        setExpanded(prev => ({
            ...prev,
            [id]: prev[id] === false ? true : false
        }));
    };

    const handleLineClick = async (filePath: string, lineNum: number) => {
        const layoutModel = getLayoutModelForStaticTab();
        let targetBlockId: string | null = null;
        if (layoutModel) {
            walkNodes(layoutModel.treeState.rootNode, (node) => {
                const bId = node.data?.blockId;
                if (bId && bId !== blockId) {
                    const otherBlockAtom = WOS.getWaveObjectAtom<Block>(`block:${bId}`);
                    const otherBlockData = globalStore.get(otherBlockAtom);
                    if (otherBlockData?.meta?.view === "preview" && !otherBlockData?.meta?.["preview:treemode"]) {
                        targetBlockId = bId;
                    }
                }
            });
        }

        if (targetBlockId) {
            const targetBCM = getBlockComponentModel(targetBlockId);
            if (targetBCM && targetBCM.viewModel) {
                const targetModel = targetBCM.viewModel as PreviewModel;
                if (targetModel.fileContentSaved) {
                    globalStore.set(targetModel.fileContentSaved, null);
                }
                if (targetModel.newFileContent) {
                    globalStore.set(targetModel.newFileContent, null);
                }
            }
            await model.env.rpc.SetMetaCommand(TabRpcClient, {
                oref: `block:${targetBlockId}`,
                meta: {
                    file: filePath,
                    connection: connName,
                    "editor:line": lineNum,
                },
            });
            refocusNode(targetBlockId);
        } else {
            const blockDef = {
                meta: {
                    view: "preview",
                    file: filePath,
                    connection: connName,
                    "editor:line": lineNum,
                },
            };
            await createBlockSplitVertically(blockDef, blockId, "after");
        }
    };

    const renderHighlight = (line: string) => {
        if (!query) return <span>{line}</span>;
        try {
            let regex: RegExp;
            if (useRegex) {
                regex = new RegExp(query, matchCase ? "g" : "gi");
            } else {
                const escaped = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
                regex = new RegExp(escaped, matchCase ? "g" : "gi");
            }
            const parts = line.split(regex);
            const matches = [...line.matchAll(regex)];
            if (parts.length === 1) return <span>{line}</span>;

            return (
                <span>
                    {parts.map((part, idx) => {
                        const matchText = matches[idx]?.[0];
                        return (
                            <React.Fragment key={idx}>
                                {part}
                                {matchText && (
                                    <mark className="bg-[rgba(234,179,8,0.35)] text-white font-semibold rounded px-[2px]">
                                        {matchText}
                                    </mark>
                                )}
                            </React.Fragment>
                        );
                    })}
                </span>
            );
        } catch (e) {
            return <span>{line}</span>;
        }
    };

    const searchTree = React.useMemo(() => buildSearchTree(results, searchDir), [results, searchDir]);

    const totalResultsCount = React.useMemo(() => {
        return results.reduce((acc, res) => acc + res.matches.length, 0);
    }, [results]);

    const renderNode = (node: SearchTreeNode, depth: number) => {
        const isExpanded = expanded[node.id] !== false;
        const iconName = getFileIcon(node.name, node.isDirectory, isExpanded);
        const iconColor = getIconColor(node.name, node.isDirectory);

        let displayLabel: React.ReactNode = node.name;
        if (!node.isDirectory) {
            const fileNode = node as TreeFileNode;
            if (fileNode.parentPathStr) {
                displayLabel = (
                    <span className="flex items-baseline gap-1.5 select-text">
                        <span>{node.name}</span>
                        <span className="text-[10px] text-muted font-normal select-none">{fileNode.parentPathStr}</span>
                    </span>
                );
            }
        }

        return (
            <div key={node.id} className="flex flex-col">
                <div
                    onClick={() => toggleExpand(node.id)}
                    className="flex items-center gap-1.5 py-0.75 px-1 hover:bg-hoverbg rounded cursor-pointer select-none text-secondary hover:text-white transition-colors"
                    style={{ paddingLeft: `${depth * 12 + 4}px` }}
                >
                    <i
                        className={makeIconClass(isExpanded ? "chevron-down" : "chevron-right", false)}
                        style={{ width: "12px", fontSize: "10px" }}
                    />
                    <i className={makeIconClass(iconName, true)} style={{ color: iconColor }} />
                    <span className="text-sm font-medium leading-none select-text">{displayLabel}</span>
                    <span className="ml-auto text-[10px] font-bold bg-[#facc15] text-[#1c1917] px-1.5 py-0.2 rounded-md">
                        {node.matchCount}
                    </span>
                </div>
                {node.isDirectory && isExpanded && (
                    <div className="flex flex-col">
                        {node.children.map(child => renderNode(child, depth + 1))}
                    </div>
                )}
                {!node.isDirectory && isExpanded && (
                    <div className="flex flex-col">
                        {(node as TreeFileNode).matches.map((match, idx) => (
                            <div
                                key={`${node.id}-${match.linenum}-${idx}`}
                                onClick={() => handleLineClick(node.path, match.linenum)}
                                className="flex items-start gap-2 pr-2 py-1 hover:bg-hoverbg rounded cursor-pointer text-xs text-muted hover:text-white transition-colors"
                                style={{ paddingLeft: `${(depth + 1) * 12 + 18}px` }}
                            >
                                <span className="font-mono text-xs break-all leading-relaxed whitespace-pre-wrap select-text">
                                    {renderHighlight(match.line)}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex flex-col w-full h-full bg-mainbg text-maintext">
            <div className="flex items-center gap-3 px-3 py-2 border-b border-border">
                <button
                    title="Back to Directory Preview"
                    onClick={async () => {
                        await model.env.rpc.SetMetaCommand(TabRpcClient, {
                            oref: `block:${model.blockId}`,
                            meta: {
                                view: "preview",
                                file: searchDir,
                                connection: connName,
                            },
                        });
                    }}
                    className="text-muted hover:text-white transition-colors"
                >
                    <i className="fa fa-solid fa-chevron-left text-sm" />
                </button>
                <span className="text-sm font-semibold uppercase tracking-wider text-secondary select-none">Search</span>
            </div>

            <div className="p-3 flex flex-col gap-2 border-b border-border/50">
                <div className="relative flex items-center border border-border bg-inputbg rounded-md focus-within:border-accent transition-colors shadow-inner px-2 py-1.5">
                    <input
                        type="text"
                        autoFocus
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Search text in files..."
                        className="bg-transparent border-0 outline-none flex-grow text-sm min-w-0 pr-16 text-white"
                    />
                    <div className="absolute right-1.5 flex gap-1 items-center select-none">
                        <button
                            title="Match Case"
                            onClick={() => {
                                const newMc = !matchCase;
                                setMatchCase(newMc);
                                handleSearch(query, newMc, useRegex);
                            }}
                            className={`text-xxs px-1.5 py-0.5 rounded font-mono transition-colors font-semibold ${
                                matchCase ? "text-accent bg-accent/20 border border-accent/30" : "text-muted hover:bg-hoverbg border border-transparent"
                            }`}
                        >
                            Aa
                        </button>
                        <button
                            title="Use Regular Expression"
                            onClick={() => {
                                const newRx = !useRegex;
                                setUseRegex(newRx);
                                handleSearch(query, matchCase, newRx);
                            }}
                            className={`text-xxs px-1.5 py-0.5 rounded font-mono transition-colors font-semibold ${
                                useRegex ? "text-accent bg-accent/20 border border-accent/30" : "text-muted hover:bg-hoverbg border border-transparent"
                            }`}
                        >
                            .*
                        </button>
                    </div>
                </div>
            </div>

            <div className="px-3 py-1.5 bg-inputbg/30 text-xxs text-muted border-b border-border/30 flex items-center gap-2 select-none">
                {loading ? (
                    <div className="flex items-center gap-1.5">
                        <i className="fa fa-solid fa-spinner fa-spin text-accent" />
                        <span>Searching...</span>
                    </div>
                ) : errorMsg ? (
                    <span className="text-error">{errorMsg}</span>
                ) : (
                    <span>
                        {totalResultsCount} results in {results.length} files under <code className="bg-hoverbg px-1 rounded">{searchDir}</code>
                    </span>
                )}
            </div>

            <div className="flex-grow overflow-hidden relative">
                <OverlayScrollbarsComponent
                    options={{ scrollbars: { autoHide: "leave" } }}
                    className="w-full h-full p-2"
                >
                    <div className="flex flex-col gap-0.5">
                        {searchTree.map(node => renderNode(node, 0))}
                    </div>
                </OverlayScrollbarsComponent>
            </div>
        </div>
    );
}
