// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { BuilderAppPanelModel, type TabType } from "@/builder/store/builder-apppanel-model";
import { BuilderFocusManager } from "@/builder/store/builder-focusmanager";
import { BuilderCodeTab } from "@/builder/tabs/builder-codetab";
import { BuilderEnvTab } from "@/builder/tabs/builder-envtab";
import { BuilderFilesTab, RenameFileModal } from "@/builder/tabs/builder-filestab";
import { BuilderPreviewTab } from "@/builder/tabs/builder-previewtab";
import { builderAppHasSelection } from "@/builder/utils/builder-focus-utils";
import { ErrorBoundary } from "@/element/errorboundary";
import { atoms } from "@/store/global";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";

const StatusDot = memo(() => {
    const model = BuilderAppPanelModel.getInstance();
    const builderStatus = useAtomValue(model.builderStatusAtom);

    const getStatusDotColor = (status: string | null | undefined): string => {
        if (!status) return "bg-gray-500";
        switch (status) {
            case "init":
            case "stopped":
                return "bg-gray-500";
            case "building":
                return "bg-warning";
            case "running":
                return "bg-success";
            case "error":
                return "bg-error";
            default:
                return "bg-gray-500";
        }
    };

    const statusDotColor = getStatusDotColor(builderStatus?.status);

    return <span className={cn("w-2 h-2 rounded-full", statusDotColor)} />;
});

StatusDot.displayName = "StatusDot";

type TabButtonProps = {
    label: string;
    tabType: TabType;
    isActive: boolean;
    isAppFocused: boolean;
    onClick: () => void;
    showStatusDot?: boolean;
};

const TabButton = memo(({ label, tabType, isActive, isAppFocused, onClick, showStatusDot }: TabButtonProps) => {
    return (
        <button
            className={cn(
                "px-4 py-2 text-sm font-medium transition-colors cursor-pointer",
                isActive
                    ? `text-primary border-b-2 ${isAppFocused ? "border-accent" : "border-gray-500"}`
                    : "text-secondary hover:text-primary border-b-2 border-transparent"
            )}
            onClick={onClick}
        >
            <span className="flex items-center gap-2">
                {showStatusDot && <StatusDot />}
                {label}
            </span>
        </button>
    );
});

TabButton.displayName = "TabButton";

const ErrorStrip = memo(() => {
    const model = BuilderAppPanelModel.getInstance();
    const errorMsg = useAtomValue(model.errorAtom);

    if (!errorMsg) return null;
    return (
        <div className="shrink-0 bg-error/10 border-b border-error/30 px-4 py-2 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
                <i className="fa fa-triangle-exclamation text-error text-sm" />
                <span className="text-error text-sm flex-1 truncate">{errorMsg}</span>
            </div>
            <button
                onClick={() => model.clearError()}
                className="shrink-0 text-error hover:text-error/80 transition-colors cursor-pointer"
                aria-label="Close error"
            >
                <i className="fa fa-xmark-large text-sm" />
            </button>
        </div>
    );
});

ErrorStrip.displayName = "ErrorStrip";

const PublishAppModal = memo(({ appName }: { appName: string }) => {
    const builderAppId = useAtomValue(atoms.builderAppId);
    const [state, setState] = useState<"confirm" | "success" | "error">("confirm");
    const [errorMessage, setErrorMessage] = useState<string>("");
    const [publishedAppId, setPublishedAppId] = useState<string>("");

    const handlePublish = async () => {
        if (!builderAppId) {
            setErrorMessage("No builder app ID found");
            setState("error");
            return;
        }

        try {
            const result = await RpcApi.PublishAppCommand(TabRpcClient, { appid: builderAppId });
            setPublishedAppId(result.publishedappid);
            setState("success");
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : String(error));
            setState("error");
        }
    };

    const handleClose = () => {
        modalsModel.popModal();
    };

    if (state === "success") {
        return (
            <Modal className="p-4" onOk={handleClose} onClose={handleClose} okLabel="OK" cancelLabel="">
                <div className="flex flex-col gap-4 mb-4">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <i className="fa fa-check-circle text-success" />
                        App Published Successfully
                    </h2>
                    <div className="flex flex-col gap-3">
                        <p className="text-primary">
                            Your app has been published to <span className="font-mono">{publishedAppId}</span>
                        </p>
                    </div>
                </div>
            </Modal>
        );
    }

    if (state === "error") {
        return (
            <Modal className="p-4" onOk={handleClose} onClose={handleClose} okLabel="OK" cancelLabel="">
                <div className="flex flex-col gap-4 mb-4">
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <i className="fa fa-triangle-exclamation text-error" />
                        Publish Failed
                    </h2>
                    <div className="flex flex-col gap-3">
                        <p className="text-error">{errorMessage}</p>
                    </div>
                </div>
            </Modal>
        );
    }

    return (
        <Modal
            className="p-4"
            onOk={handlePublish}
            onCancel={handleClose}
            onClose={handleClose}
            okLabel="Publish"
            cancelLabel="Cancel"
        >
            <div className="flex flex-col gap-4 mb-4">
                <h2 className="text-xl font-semibold">Publish App</h2>
                <div className="flex flex-col gap-3">
                    <p className="text-primary">
                        This will publish your app to <span className="font-mono">local/{appName}</span>
                    </p>
                    <p className="text-warning">
                        <i className="fa fa-triangle-exclamation mr-2" />
                        This will overwrite any existing app with the same name. Are you sure?
                    </p>
                </div>
            </div>
        </Modal>
    );
});

PublishAppModal.displayName = "PublishAppModal";

const BuilderAppPanel = memo(() => {
    const model = BuilderAppPanelModel.getInstance();
    const focusElemRef = useRef<HTMLInputElement>(null);
    const activeTab = useAtomValue(model.activeTab);
    const focusType = useAtomValue(BuilderFocusManager.getInstance().focusType);
    const isAppFocused = focusType === "app";
    const envSaveNeeded = useAtomValue(model.envVarsDirtyAtom);
    const builderAppId = useAtomValue(atoms.builderAppId);
    const builderId = useAtomValue(atoms.builderId);

    useEffect(() => {
        model.initialize();
    }, []);

    if (focusElemRef.current) {
        model.setFocusElemRef(focusElemRef.current);
    }

    const handleTabClick = (tab: TabType) => {
        model.setActiveTab(tab);
        BuilderFocusManager.getInstance().setAppFocused();
        model.giveFocus();
    };

    const handleFocusCapture = useCallback((event: React.FocusEvent) => {
        BuilderFocusManager.getInstance().setAppFocused();
    }, []);

    const handlePanelClick = useCallback(
        (e: React.MouseEvent) => {
            const target = e.target as HTMLElement;
            const isInteractive = target.closest('button, a, input, textarea, select, [role="button"], [tabindex]');

            if (isInteractive) {
                return;
            }

            const hasSelection = builderAppHasSelection();
            if (hasSelection) {
                BuilderFocusManager.getInstance().setAppFocused();
                return;
            }

            setTimeout(() => {
                if (!builderAppHasSelection()) {
                    BuilderFocusManager.getInstance().setAppFocused();
                    model.giveFocus();
                }
            }, 0);
        },
        [model]
    );

    const handleEnvSave = useCallback(() => {
        if (builderId) {
            model.saveEnvVars(builderId);
        }
    }, [builderId, model]);

    const handleRestart = useCallback(() => {
        model.restartBuilder();
    }, [model]);

    const handlePublishClick = useCallback(() => {
        if (!builderAppId) return;
        const appName = builderAppId.replace("draft/", "");
        modalsModel.pushModal("PublishAppModal", { appName });
    }, [builderAppId]);

    return (
        <div
            className="w-full h-full flex flex-col border-b-3 border-border shadow-[0_2px_4px_rgba(0,0,0,0.1)]"
            data-builder-app-panel="true"
            onClick={handlePanelClick}
            onFocusCapture={handleFocusCapture}
        >
            <div key="focuselem" className="h-0 w-0">
                <input
                    type="text"
                    value=""
                    ref={focusElemRef}
                    className="h-0 w-0 opacity-0 pointer-events-none"
                    onChange={() => {}}
                />
            </div>
            <div className="shrink-0 border-b border-border">
                <div className="flex items-center justify-between">
                    <div className="flex">
                        <TabButton
                            label="Preview"
                            tabType="preview"
                            isActive={activeTab === "preview"}
                            isAppFocused={isAppFocused}
                            onClick={() => handleTabClick("preview")}
                            showStatusDot={true}
                        />
                        <TabButton
                            label="Code"
                            tabType="code"
                            isActive={activeTab === "code"}
                            isAppFocused={isAppFocused}
                            onClick={() => handleTabClick("code")}
                        />
                        <TabButton
                            label="Files"
                            tabType="files"
                            isActive={activeTab === "files"}
                            isAppFocused={isAppFocused}
                            onClick={() => handleTabClick("files")}
                        />
                        <TabButton
                            label="Env"
                            tabType="env"
                            isActive={activeTab === "env"}
                            isAppFocused={isAppFocused}
                            onClick={() => handleTabClick("env")}
                        />
                    </div>
                    <div className="flex items-center gap-2 mr-4">
                        <button
                            className="px-3 py-1 text-sm font-medium rounded bg-accent/80 text-primary hover:bg-accent transition-colors cursor-pointer"
                            onClick={handlePublishClick}
                        >
                            Publish App
                        </button>
                    </div>
                    {activeTab === "env" && (
                        <button
                            className={cn(
                                "mr-4 px-3 py-1 text-sm font-medium rounded transition-colors",
                                envSaveNeeded
                                    ? "bg-accent text-white hover:opacity-80 cursor-pointer"
                                    : "bg-gray-600 text-gray-400 cursor-default"
                            )}
                            onClick={envSaveNeeded ? handleEnvSave : undefined}
                        >
                            Save
                        </button>
                    )}
                </div>
            </div>
            <ErrorStrip />
            <div className="flex-1 overflow-auto py-1">
                <div className="w-full h-full" style={{ display: activeTab === "preview" ? "block" : "none" }}>
                    <ErrorBoundary>
                        <BuilderPreviewTab />
                    </ErrorBoundary>
                </div>
                <div className="w-full h-full" style={{ display: activeTab === "code" ? "block" : "none" }}>
                    <ErrorBoundary>
                        <BuilderCodeTab />
                    </ErrorBoundary>
                </div>
                <div className="w-full h-full" style={{ display: activeTab === "files" ? "block" : "none" }}>
                    <ErrorBoundary>
                        <BuilderFilesTab />
                    </ErrorBoundary>
                </div>
                <div className="w-full h-full" style={{ display: activeTab === "env" ? "block" : "none" }}>
                    <ErrorBoundary>
                        <BuilderEnvTab />
                    </ErrorBoundary>
                </div>
            </div>
        </div>
    );
});

BuilderAppPanel.displayName = "BuilderAppPanel";

export { BuilderAppPanel, PublishAppModal, RenameFileModal };
