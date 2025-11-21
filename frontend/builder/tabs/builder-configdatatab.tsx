// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BuilderAppPanelModel } from "@/builder/store/builder-apppanel-model";
import { atoms } from "@/store/global";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useState } from "react";

const NotRunningView = memo(() => {
    return (
        <div className="w-full h-full flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-6 max-w-[500px] text-center px-8">
                <i className="fa fa-triangle-exclamation text-6xl text-warning" />
                <div className="flex flex-col gap-3">
                    <h2 className="text-2xl font-semibold text-primary">App Not Running</h2>
                    <p className="text-base text-secondary leading-relaxed">
                        The tsunami app must be running to view config and data. Please start the app from the Preview
                        tab first.
                    </p>
                </div>
            </div>
        </div>
    );
});

NotRunningView.displayName = "NotRunningView";

const ErrorView = memo(({ errorMsg }: { errorMsg: string }) => {
    return (
        <div className="w-full h-full flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-6 max-w-2xl text-center px-8">
                <i className="fa fa-circle-xmark text-6xl text-error" />
                <div className="flex flex-col gap-3">
                    <h2 className="text-2xl font-semibold text-error">Error Loading Data</h2>
                    <div className="text-left bg-panel border border-error/30 rounded-lg p-4">
                        <pre className="text-sm text-secondary whitespace-pre-wrap font-mono">{errorMsg}</pre>
                    </div>
                </div>
            </div>
        </div>
    );
});

ErrorView.displayName = "ErrorView";

const LoadingView = memo(() => {
    return (
        <div className="w-full h-full flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-6">
                <i className="fa fa-spinner fa-spin text-6xl text-secondary" />
                <p className="text-base text-secondary">Loading data...</p>
            </div>
        </div>
    );
});

LoadingView.displayName = "LoadingView";

type ConfigDataState = {
    config: any;
    data: any;
    error: string | null;
    isLoading: boolean;
};

const BuilderConfigDataTab = memo(() => {
    const model = BuilderAppPanelModel.getInstance();
    const builderStatus = useAtomValue(model.builderStatusAtom);
    const builderId = useAtomValue(atoms.builderId);
    const [state, setState] = useState<ConfigDataState>({
        config: null,
        data: null,
        error: null,
        isLoading: false,
    });

    const isRunning = builderStatus?.status === "running" && builderStatus?.port && builderStatus.port !== 0;

    const fetchData = useCallback(async () => {
        if (!isRunning || !builderStatus?.port) {
            return;
        }

        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        try {
            const baseUrl = `http://localhost:${builderStatus.port}`;

            const [configResponse, dataResponse] = await Promise.all([
                fetch(`${baseUrl}/api/config`),
                fetch(`${baseUrl}/api/data`),
            ]);

            if (!configResponse.ok) {
                throw new Error(`Failed to fetch config: ${configResponse.statusText}`);
            }
            if (!dataResponse.ok) {
                throw new Error(`Failed to fetch data: ${dataResponse.statusText}`);
            }

            const config = await configResponse.json();
            const data = await dataResponse.json();

            setState({
                config,
                data,
                error: null,
                isLoading: false,
            });
        } catch (err) {
            setState({
                config: null,
                data: null,
                error: err instanceof Error ? err.message : String(err),
                isLoading: false,
            });
        }
    }, [isRunning, builderStatus?.port]);

    const handleRefresh = useCallback(async () => {
        setState({
            config: null,
            data: null,
            error: null,
            isLoading: true,
        });

        await new Promise((resolve) => setTimeout(resolve, 200));
        await fetchData();
    }, [fetchData]);

    useEffect(() => {
        if (isRunning) {
            fetchData();
        } else {
            setState({
                config: null,
                data: null,
                error: null,
                isLoading: false,
            });
        }
    }, [isRunning, fetchData]);

    if (!isRunning) {
        return <NotRunningView />;
    }

    if (state.isLoading) {
        return <LoadingView />;
    }

    if (state.error) {
        return <ErrorView errorMsg={state.error} />;
    }

    if (!state.config && !state.data) {
        return <LoadingView />;
    }

    return (
        <div className="w-full h-full flex flex-col bg-background">
            <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border">
                <h3 className="text-lg font-semibold text-primary">Config & Data</h3>
                <button
                    onClick={handleRefresh}
                    className="px-3 py-1 text-sm font-medium rounded bg-accent/80 text-primary hover:bg-accent transition-colors cursor-pointer flex items-center gap-2"
                >
                    <i className="fa fa-refresh" />
                    Refresh
                </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                        <h4 className="text-base font-semibold text-primary flex items-center gap-2">
                            <i className="fa fa-gear" />
                            Config
                        </h4>
                        <div className="bg-panel border border-border rounded-lg p-4 overflow-auto">
                            <pre className="text-sm text-primary font-mono whitespace-pre">
                                {JSON.stringify(state.config, null, 2)}
                            </pre>
                        </div>
                    </div>
                    <div className="flex flex-col gap-2">
                        <h4 className="text-base font-semibold text-primary flex items-center gap-2">
                            <i className="fa fa-database" />
                            Data
                        </h4>
                        <div className="bg-panel border border-border rounded-lg p-4 overflow-auto">
                            <pre className="text-sm text-primary font-mono whitespace-pre">
                                {JSON.stringify(state.data, null, 2)}
                            </pre>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

BuilderConfigDataTab.displayName = "BuilderConfigDataTab";

export { BuilderConfigDataTab };