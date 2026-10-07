// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { DiffViewer } from "@/app/view/codeeditor/diffviewer";
import { cn } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import type { GitDiffViewModel } from "./gitdiff-model";
import { isWshOutdatedError, splitRepoPath } from "./gitdiff-util";

const StatusDecl: Record<string, { letter: string; className: string; label: string }> = {
    modified: { letter: "M", className: "text-warning", label: "Modified" },
    added: { letter: "A", className: "text-success", label: "Added" },
    deleted: { letter: "D", className: "text-error", label: "Deleted" },
    renamed: { letter: "R", className: "text-accent", label: "Renamed" },
    untracked: { letter: "U", className: "text-success", label: "Untracked" },
    conflicted: { letter: "C", className: "text-error", label: "Conflicted" },
};

function Placeholder({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div
            className={cn(
                "flex flex-col items-center justify-center w-full h-full gap-2 text-secondary p-4",
                className
            )}
        >
            {children}
        </div>
    );
}

type FileRowProps = {
    file: GitFileStatus;
    selected: boolean;
    onSelect: () => void;
    onRevert: () => void;
};

function FileRow({ file, selected, onSelect, onRevert }: FileRowProps) {
    const decl = StatusDecl[file.status] ?? StatusDecl.modified;
    const { dir, name } = splitRepoPath(file.path);
    const title = file.origpath ? `${file.origpath} → ${file.path}` : file.path;
    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) {
            return;
        }
        e.preventDefault();
        onSelect();
    };
    return (
        <div
            role="button"
            tabIndex={0}
            aria-current={selected || undefined}
            className={cn(
                "group flex items-center gap-2 px-2 py-1 cursor-pointer text-sm select-none outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent",
                selected ? "bg-hoverbg" : "hover:bg-hover"
            )}
            title={title}
            onClick={onSelect}
            onKeyDown={handleKeyDown}
        >
            <span className={cn("w-3 shrink-0 font-mono text-xs font-bold", decl.className)} title={decl.label}>
                {decl.letter}
            </span>
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                <span className="truncate text-primary">{name}</span>
                {dir && <span className="truncate text-xs text-muted">{dir}</span>}
            </div>
            <div className="flex shrink-0 items-center gap-1 font-mono text-xs group-hover:hidden group-focus-within:hidden">
                {file.binary ? (
                    <span className="text-muted">bin</span>
                ) : (
                    <>
                        {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
                        {file.deletions > 0 && <span className="text-error">−{file.deletions}</span>}
                    </>
                )}
            </div>
            <button
                className="hidden shrink-0 cursor-pointer rounded-sm text-xs text-secondary outline-none hover:text-primary focus-visible:text-primary focus-visible:ring-1 focus-visible:ring-accent group-hover:block group-focus-within:block"
                title={file.status === "untracked" ? "Delete File" : "Discard Changes"}
                aria-label={file.status === "untracked" ? "Delete File" : "Discard Changes"}
                onClick={(e) => {
                    e.stopPropagation();
                    onRevert();
                }}
            >
                <i className="fa-sharp fa-solid fa-rotate-left" />
            </button>
        </div>
    );
}

function FileList({ model }: { model: GitDiffViewModel }) {
    const status = jotai.useAtomValue(model.statusAtom);
    const selectedPath = jotai.useAtomValue(model.selectedPathAtom);
    const files = status?.files ?? [];
    return (
        <div className="flex w-[260px] min-w-[180px] shrink-0 flex-col overflow-y-auto border-r border-border py-1">
            {files.map((file) => (
                <FileRow
                    key={file.path}
                    file={file}
                    selected={file.path === selectedPath}
                    onSelect={() => model.selectFile(file)}
                    onRevert={() => model.revertFile(file)}
                />
            ))}
            {status?.truncated && (
                <div className="px-2 py-1 text-xs text-muted">Showing the first {files.length} changed files</div>
            )}
        </div>
    );
}

function DiffPane({ blockId, model }: { blockId: string; model: GitDiffViewModel }) {
    const fileDiff = jotai.useAtomValue(model.fileDiffAtom);
    if (fileDiff == null || fileDiff.loading) {
        return <Placeholder>Loading diff...</Placeholder>;
    }
    if (fileDiff.error) {
        return <Placeholder className="text-error">{fileDiff.error}</Placeholder>;
    }
    if (fileDiff.binary) {
        return <Placeholder>Binary file — diff not shown</Placeholder>;
    }
    if (fileDiff.toolarge) {
        return <Placeholder>File is too large to diff</Placeholder>;
    }
    return (
        <DiffViewer
            key={fileDiff.path}
            blockId={blockId}
            original={fileDiff.original}
            modified={fileDiff.modified}
            fileName={fileDiff.path}
        />
    );
}

export function GitDiffView({ blockId, model }: ViewComponentProps<GitDiffViewModel>) {
    const status = jotai.useAtomValue(model.statusAtom);
    const loading = jotai.useAtomValue(model.loadingAtom);
    const error = jotai.useAtomValue(model.errorAtom);
    const connStatus = jotai.useAtomValue(model.connStatus);
    const cwd = jotai.useAtomValue(model.cwdAtom);
    const connection = jotai.useAtomValue(model.connection);

    React.useEffect(() => {
        model.resetState();
        model.startPolling();
        return () => model.stopPolling();
    }, [cwd, connection]);

    if (!connStatus?.connected) {
        return <Placeholder>Not connected to {connection}</Placeholder>;
    }
    if (cwd == null) {
        return <Placeholder>No directory set for this block</Placeholder>;
    }
    if (status == null) {
        if (isWshOutdatedError(error)) {
            return <Placeholder>Update wsh on this connection to use Git Diff</Placeholder>;
        }
        if (error) {
            return <Placeholder className="text-error">{error}</Placeholder>;
        }
        if (loading) {
            return <Placeholder>Loading changes...</Placeholder>;
        }
        return null;
    }
    if (status.notrepo) {
        return (
            <Placeholder>
                <i className="fa-sharp fa-solid fa-code-branch text-2xl text-muted" />
                <div>Not a git repository</div>
                <div className="font-mono text-xs text-muted">{cwd}</div>
            </Placeholder>
        );
    }
    const files = status.files ?? [];
    return (
        <div className="flex h-full w-full flex-col overflow-hidden">
            {error && <div className="shrink-0 border-b border-border px-2 py-1 text-xs text-error">{error}</div>}
            {files.length === 0 ? (
                <Placeholder>
                    <i className="fa-sharp fa-solid fa-check text-2xl text-success" />
                    <div>No changes — working tree is clean</div>
                </Placeholder>
            ) : (
                <div className="flex min-h-0 flex-1">
                    <FileList model={model} />
                    <div className="min-w-0 flex-1">
                        <DiffPane blockId={blockId} model={model} />
                    </div>
                </div>
            )}
        </div>
    );
}
