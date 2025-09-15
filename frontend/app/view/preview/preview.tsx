// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { CopyButton } from "@/app/element/copybutton";
import { CenteredDiv } from "@/app/element/quickelems";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { BlockHeaderSuggestionControl } from "@/app/suggestion/suggestion";
import { globalStore } from "@/store/global";
import { isBlank, makeConnRoute } from "@/util/util";
import clsx from "clsx";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { memo, useCallback, useEffect } from "react";
import { CSVView } from "./csvview";
import { DirectoryPreview } from "./preview-directory";
import { CodeEditPreview } from "./preview-edit";
import { MarkdownPreview } from "./preview-markdown";
import type { PreviewModel } from "./preview-model";
import { StreamingPreview } from "./preview-streaming";
import "./preview.scss";

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
        return <CenteredDiv>Invalid Specialzied View Component ({specializedView.specializedView})</CenteredDiv>;
    }
    return <SpecializedViewComponent key={path} model={model} parentRef={parentRef} />;
});

const fetchSuggestions = async (
    model: PreviewModel,
    query: string,
    reqContext: SuggestionRequestContext
): Promise<FetchSuggestionsResponse> => {
    const conn = await globalStore.get(model.connection);
    let route = makeConnRoute(conn);
    if (isBlank(conn) || conn.startsWith("aws:")) {
        route = null;
    }
    if (reqContext?.dispose) {
        RpcApi.DisposeSuggestionsCommand(TabRpcClient, reqContext.widgetid, { noresponse: true, route: route });
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
    return await RpcApi.FetchSuggestionsCommand(TabRpcClient, sdata, {
        route: route,
    });
};

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
    const connStatus = useAtomValue(model.connStatus);
    const [errorMsg, setErrorMsg] = useAtom(model.errorMsgAtom);
    const connection = useAtomValue(model.connectionImmediate);
    const fileInfo = useAtomValue(model.statFile);

    useEffect(() => {
        console.log("fileInfo or connection changed", fileInfo, connection);
        if (!fileInfo) {
            return;
        }
        setErrorMsg(null);
    }, [connection, fileInfo]);

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
        return await fetchSuggestions(model, query, ctx);
    };

    return (
        <>
            <div key="fullpreview" className="full-preview scrollbar-hide-until-hover">
                {errorMsg && <ErrorOverlay errorMsg={errorMsg} resetOverlay={() => setErrorMsg(null)} />}
                <div ref={contentRef} className="full-preview-content">
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

const ErrorOverlay = memo(({ errorMsg, resetOverlay }: { errorMsg: ErrorMsg; resetOverlay: () => void }) => {
    const showDismiss = errorMsg.showDismiss ?? true;
    const buttonClassName = "outlined grey font-size-11 vertical-padding-3 horizontal-padding-7";

    let iconClass = "fa-solid fa-circle-exclamation text-[var(--error-color)] text-base";
    if (errorMsg.level == "warning") {
        iconClass = "fa-solid fa-triangle-exclamation text-[var(--warning-color)] text-base";
    }

    const handleCopyToClipboard = useCallback(async () => {
        await navigator.clipboard.writeText(errorMsg.text);
    }, [errorMsg.text]);

    return (
        <div className="absolute top-[0] left-1.5 right-1.5 z-[var(--zindex-block-mask-inner)] overflow-hidden bg-[var(--conn-status-overlay-bg-color)] backdrop-blur-[50px] rounded-md shadow-lg">
            <div className="flex flex-row justify-between p-2.5 pl-3 font-[var(--base-font)] text-[var(--secondary-text-color)]">
                <div
                    className={clsx("flex flex-row items-center gap-3 grow min-w-0 shrink", {
                        "items-start": true,
                    })}
                >
                    <i className={iconClass}></i>

                    <div className="flex flex-col items-start gap-1 grow w-full shrink min-w-0">
                        <div className="max-w-full text-xs font-semibold leading-4 tracking-[0.11px] text-white overflow-hidden">
                            {errorMsg.status}
                        </div>

                        <OverlayScrollbarsComponent
                            className="group text-xs font-normal leading-[15px] tracking-[0.11px] text-wrap max-h-20 rounded-lg py-1.5 pl-0 relative w-full"
                            options={{ scrollbars: { autoHide: "leave" } }}
                        >
                            <CopyButton
                                className="invisible group-hover:visible flex absolute top-0 right-1 rounded backdrop-blur-lg p-1 items-center justify-end gap-1"
                                onClick={handleCopyToClipboard}
                                title="Copy"
                            />
                            <div>{errorMsg.text}</div>
                        </OverlayScrollbarsComponent>
                        {!!errorMsg.buttons && (
                            <div className="flex flex-row gap-2">
                                {errorMsg.buttons?.map((buttonDef) => (
                                    <Button
                                        className={buttonClassName}
                                        onClick={() => {
                                            buttonDef.onClick();
                                            resetOverlay();
                                        }}
                                        key={crypto.randomUUID()}
                                    >
                                        {buttonDef.text}
                                    </Button>
                                ))}
                            </div>
                        )}
                    </div>

                    {showDismiss && (
                        <div className="flex items-start">
                            <Button
                                className={clsx(buttonClassName, "fa-xmark fa-solid")}
                                onClick={() => {
                                    if (errorMsg.closeAction) {
                                        errorMsg.closeAction();
                                    }
                                    resetOverlay();
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

export { PreviewView };
