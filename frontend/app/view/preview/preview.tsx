// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CenteredDiv } from "@/app/element/quickelems";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { BlockHeaderSuggestionControl } from "@/app/suggestion/suggestion";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { BlockModel } from "@/app/block/block-model";
import * as WOS from "@/store/wos";
import { fireAndForget, isBlank, makeConnRoute, stringToBase64 } from "@/util/util";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { CSVView } from "./csvview";
import { DirectoryPreview } from "./preview-directory";
import { CodeEditPreview } from "./preview-edit";
import { ErrorOverlay } from "./preview-error-overlay";
import { MarkdownPreview } from "./preview-markdown";
import type { PreviewModel } from "./preview-model";
import { StreamingPreview } from "./preview-streaming";
import type { PreviewEnv } from "./previewenv";

function posixEscapePath(path: string): string {
    if (path === "~") return "~";
    if (path.startsWith("~/")) {
        return "~/" + "'" + path.slice(2).replace(/'/g, "'\\''") + "'";
    }
    return "'" + path.replace(/'/g, "'\\''") + "'";
}

function powershellEscapePath(path: string): string {
    if (path === "~") return "~";
    if (path.startsWith("~/")) {
        return "~/" + "'" + path.slice(2).replace(/'/g, "''") + "'";
    }
    return "'" + path.replace(/'/g, "''") + "'";
}

function cmdEscapePath(path: string): string {
    if (path.startsWith("~/")) {
        return '"%USERPROFILE%\\' + path.slice(2).replace(/\//g, "\\") + '"';
    }
    if (path.includes(" ")) {
        return '"' + path.replace(/\//g, "\\") + '"';
    }
    return path.replace(/\//g, "\\");
}

function getShellType(termBlockId: string): string {
    const termBlock = WOS.getObjectValue<Block>(WOS.makeORef("block", termBlockId), globalStore.get);
    const shellPath = (termBlock?.meta?.["cmd:shell"] as string) ?? "";
    if (shellPath.includes("powershell") || shellPath.includes("pwsh")) {
        return "powershell";
    }
    if (shellPath.includes("cmd.exe")) {
        return "cmd";
    }
    return "posix";
}

async function sendCdToTerminal(termBlockId: string, path: string, env: import("./previewenv").PreviewEnv) {
    const shellType = getShellType(termBlockId);
    let command: string;

    switch (shellType) {
        case "powershell":
            command = "cd " + powershellEscapePath(path) + "\r";
            break;
        case "cmd":
            command = "cd " + cmdEscapePath(path) + "\r";
            break;
        case "posix":
        default:
            command = "\x15cd " + posixEscapePath(path) + "\r";
            break;
    }

    await env.rpc.ControllerInputCommand(TabRpcClient, { blockid: termBlockId, inputdata64: stringToBase64(command) });
}

export type SpecializedViewProps = {
    model: PreviewModel;
    parentRef: React.RefObject<HTMLDivElement>;
};

const SpecializedViewMap: { [view: string]: ({ model }: SpecializedViewProps) => React.JSX.Element } = {
    streaming: StreamingPreview,
    markdown: MarkdownPreview,
    codeedit: CodeEditPreview,
    csv: CSVViewPreview,
    directory: DirectoryPreview,
};

function canPreview(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return mimeType.startsWith("text/markdown") || mimeType.startsWith("text/csv");
}

function CSVViewPreview({ model, parentRef }: SpecializedViewProps) {
    const fileContent = useAtomValue(model.fileContent);
    const fileName = useAtomValue(model.statFilePath);
    return <CSVView parentRef={parentRef} readonly={true} content={fileContent} filename={fileName} />;
}

const SpecializedView = memo(({ parentRef, model }: SpecializedViewProps) => {
    const specializedView = useAtomValue(model.specializedView);
    const mimeType = useAtomValue(model.fileMimeType);
    const setCanPreview = useSetAtom(model.canPreview);
    const path = useAtomValue(model.statFilePath);

    useEffect(() => {
        setCanPreview(canPreview(mimeType));
    }, [mimeType, setCanPreview]);

    if (specializedView.errorStr != null) {
        return <CenteredDiv>{specializedView.errorStr}</CenteredDiv>;
    }
    const SpecializedViewComponent = SpecializedViewMap[specializedView.specializedView];
    if (!SpecializedViewComponent) {
        return <CenteredDiv>Invalid Specialized View Component ({specializedView.specializedView})</CenteredDiv>;
    }
    return <SpecializedViewComponent key={path} model={model} parentRef={parentRef} />;
});

const fetchSuggestions = async (
    env: PreviewEnv,
    model: PreviewModel,
    query: string,
    reqContext: SuggestionRequestContext
): Promise<FetchSuggestionsResponse> => {
    const conn = await globalStore.get(model.connection);
    let route = makeConnRoute(conn);
    if (isBlank(conn)) {
        route = null;
    }
    if (reqContext?.dispose) {
        env.rpc.DisposeSuggestionsCommand(TabRpcClient, reqContext.widgetid, { noresponse: true, route: route });
        return null;
    }
    const fileInfo = await globalStore.get(model.statFile);
    if (fileInfo == null) {
        return null;
    }
    const sdata = {
        suggestiontype: "file",
        "file:cwd": fileInfo.path,
        query: query,
        widgetid: reqContext.widgetid,
        reqnum: reqContext.reqnum,
        "file:connection": conn,
    };
    return await env.rpc.FetchSuggestionsCommand(TabRpcClient, sdata, {
        route: route,
    });
};

function FollowTermDropdown({ model }: { model: PreviewModel }) {
    const menuData = useAtomValue(model.followTermMenuDataAtom);
    const menuRef = useRef<HTMLDivElement>(null);
    const previousActiveElement = useRef<Element | null>(null);

    if (!menuData) return null;

    const { pos, terms, currentFollowId, bidir } = menuData;
    const closeMenu = () => {
        BlockModel.getInstance().setBlockHighlight(null);
        globalStore.set(model.followTermMenuDataAtom, null);
        if (previousActiveElement.current instanceof HTMLElement) {
            previousActiveElement.current.focus();
        }
    };
    const linkTerm = (blockId: string) => {
        BlockModel.getInstance().setBlockHighlight(null);
        fireAndForget(async () => {
            await model.env.services.object.UpdateObjectMeta(WOS.makeORef("block", model.blockId), {
                "preview:followtermid": blockId,
                "preview:followterm:bidir": false,
            });
        });
        globalStore.set(model.followTermMenuDataAtom, null);
        if (previousActiveElement.current instanceof HTMLElement) {
            previousActiveElement.current.focus();
        }
    };
    const toggleBidir = () => {
        fireAndForget(async () => {
            await model.env.services.object.UpdateObjectMeta(WOS.makeORef("block", model.blockId), {
                "preview:followterm:bidir": !bidir,
            });
        });
        globalStore.set(model.followTermMenuDataAtom, { ...menuData, bidir: !bidir });
    };
    const unlink = () => {
        fireAndForget(async () => {
            await model.env.services.object.UpdateObjectMeta(WOS.makeORef("block", model.blockId), {
                "preview:followtermid": null,
                "preview:followterm:bidir": null,
            });
        });
        globalStore.set(model.followTermMenuDataAtom, null);
        if (previousActiveElement.current instanceof HTMLElement) {
            previousActiveElement.current.focus();
        }
    };

    useEffect(() => {
        previousActiveElement.current = document.activeElement;
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                closeMenu();
            }
        };
        document.addEventListener("keydown", handleEscape);
        if (menuRef.current) {
            const firstItem = menuRef.current.querySelector('[role="menuitem"]');
            if (firstItem instanceof HTMLElement) {
                firstItem.focus();
            }
        }
        return () => {
            document.removeEventListener("keydown", handleEscape);
        };
    }, []);

    const dropdownStyle: React.CSSProperties = {
        left: pos.x,
        top: pos.y,
        background: "var(--modal-bg-color)",
        border: "1px solid var(--border-color)",
        boxShadow: "0px 8px 24px 0px rgba(0,0,0,0.4)",
        borderRadius: "var(--modal-border-radius)",
    };
    const dividerStyle: React.CSSProperties = { borderTop: "1px solid var(--border-color)" };

    return ReactDOM.createPortal(
        <>
            <div className="fixed inset-0 z-[9998]" onMouseDown={closeMenu} />
            <div ref={menuRef} className="fixed z-[9999] py-1 min-w-[200px] text-sm" style={dropdownStyle} role="menu">
                {terms.length === 0 ? (
                    <div className="px-3 py-1.5 opacity-50">No terminals on this tab</div>
                ) : (
                    terms.map(({ blockId, title }) => (
                        <div
                            key={blockId}
                            role="menuitem"
                            tabIndex={0}
                            aria-label={`Follow terminal: ${title}`}
                            className="px-3 py-1.5 cursor-pointer hover:bg-white/10 flex items-center gap-2"
                            onMouseEnter={() =>
                                BlockModel.getInstance().setBlockHighlight({ blockId, icon: "terminal" })
                            }
                            onMouseLeave={() => BlockModel.getInstance().setBlockHighlight(null)}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={() => linkTerm(blockId)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    linkTerm(blockId);
                                }
                            }}
                        >
                            <i className="fa-sharp fa-solid fa-terminal opacity-50" />
                            {title}
                        </div>
                    ))
                )}
                {currentFollowId && (
                    <>
                        <div className="my-1" style={dividerStyle} />
                        <div
                            role="menuitem"
                            tabIndex={0}
                            aria-label={`Bidirectional following: ${bidir ? "enabled" : "disabled"}`}
                            className="px-3 py-1.5 cursor-pointer hover:bg-white/10 flex items-center gap-2"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={toggleBidir}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    toggleBidir();
                                }
                            }}
                        >
                            <i
                                className={
                                    bidir
                                        ? "fa-sharp fa-solid fa-square-check"
                                        : "fa-sharp fa-regular fa-square"
                                }
                                style={{ color: bidir ? "var(--success-color)" : undefined, width: 14 }}
                            />
                            Bidirectional
                        </div>
                        <div className="my-1" style={dividerStyle} />
                        <div
                            role="menuitem"
                            tabIndex={0}
                            aria-label="Stop following terminal"
                            className="px-3 py-1.5 cursor-pointer hover:bg-white/10"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={unlink}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    unlink();
                                }
                            }}
                        >
                            Stop Following
                        </div>
                    </>
                )}
            </div>
        </>,
        document.body
    );
}

function PreviewView({
    blockRef,
    contentRef,
    model,
}: {
    blockId: string;
    blockRef: React.RefObject<HTMLDivElement>;
    contentRef: React.RefObject<HTMLDivElement>;
    model: PreviewModel;
}) {
    const env = useWaveEnv<PreviewEnv>();
    const connStatus = useAtomValue(model.connStatus);
    const [errorMsg, setErrorMsg] = useAtom(model.errorMsgAtom);
    const connection = useAtomValue(model.connectionImmediate);
    const fileInfo = useAtomValue(model.statFile);
    const followTermId = useAtomValue(model.followTermIdAtom);
    const followTermCwd = useAtomValue(model.followTermCwdAtom);
    const followTermBidir = useAtomValue(model.followTermBidirAtom);
    const loadableFileInfo = useAtomValue(model.loadableFileInfo);
    const suppressBidirRef = useRef(false);

    useEffect(() => {
        console.log("fileInfo or connection changed", fileInfo, connection);
        if (!fileInfo) {
            return;
        }
        setErrorMsg(null);
    }, [connection, fileInfo]);

    useEffect(() => {
        if (!followTermId || !followTermCwd) return;
        suppressBidirRef.current = true;
        fireAndForget(() => model.goHistory(followTermCwd));
        const timer = setTimeout(() => {
            suppressBidirRef.current = false;
        }, 100);
        return () => clearTimeout(timer);
    }, [followTermCwd, followTermId, model]);

    useEffect(() => {
        if (!followTermId || !followTermBidir) return;
        if (suppressBidirRef.current) {
            suppressBidirRef.current = false;
            return;
        }
        if (loadableFileInfo.state !== "hasData") return;
        const fi = loadableFileInfo.data;
        if (!fi || fi.mimetype !== "directory" || !fi.path) return;
        fireAndForget(() => sendCdToTerminal(followTermId, fi.path, env));
    }, [loadableFileInfo, followTermId, followTermBidir, env]);

    if (connStatus?.status != "connected") {
        return null;
    }
    const handleSelect = (s: SuggestionType, queryStr: string): boolean => {
        if (s == null) {
            if (isBlank(queryStr)) {
                globalStore.set(model.openFileModal, false);
                return true;
            }
            model.handleOpenFile(queryStr);
            return true;
        }
        model.handleOpenFile(s["file:path"]);
        return true;
    };
    const handleTab = (s: SuggestionType, query: string): string => {
        if (s["file:mimetype"] == "directory") {
            return s["file:name"] + "/";
        } else {
            return s["file:name"];
        }
    };
    const fetchSuggestionsFn = async (query, ctx) => {
        return await fetchSuggestions(env, model, query, ctx);
    };

    return (
        <>
            <FollowTermDropdown model={model} />
            <div key="fullpreview" className="flex flex-col w-full overflow-hidden scrollbar-hide-until-hover">
                {errorMsg && <ErrorOverlay errorMsg={errorMsg} resetOverlay={() => setErrorMsg(null)} />}
                <div ref={contentRef} className="flex-grow overflow-hidden">
                    <SpecializedView parentRef={contentRef} model={model} />
                </div>
            </div>
            <BlockHeaderSuggestionControl
                blockRef={blockRef}
                openAtom={model.openFileModal}
                onClose={() => model.updateOpenFileModalAndError(false)}
                onSelect={handleSelect}
                onTab={handleTab}
                fetchSuggestions={fetchSuggestionsFn}
                placeholderText="Open File..."
            />
        </>
    );
}

export { PreviewView };
