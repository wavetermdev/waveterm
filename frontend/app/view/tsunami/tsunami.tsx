// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { atoms, globalStore, WOS } from "@/app/store/global";
import { waveEventSubscribe } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WebView, WebViewModel } from "@/app/view/webview/webview";
import * as services from "@/store/services";
import * as jotai from "jotai";
import { memo, useEffect } from "react";

class TsunamiViewModel extends WebViewModel {
    shellProcFullStatus: jotai.PrimitiveAtom<BlockControllerRuntimeStatus>;
    shellProcStatusUnsubFn: () => void;
    isRestarting: jotai.PrimitiveAtom<boolean>;

    constructor(blockId: string, nodeModel: BlockNodeModel) {
        super(blockId, nodeModel);
        this.viewType = "tsunami";
        this.viewIcon = jotai.atom("cube");
        this.viewName = jotai.atom("Tsunami");
        this.isRestarting = jotai.atom(false);

        // Hide navigation bar (URL bar, back/forward/home buttons)
        this.hideNav = jotai.atom(true);

        // Set custom partition for tsunami WebView isolation
        this.partitionOverride = jotai.atom(`tsunami:${blockId}`);

        this.shellProcFullStatus = jotai.atom(null) as jotai.PrimitiveAtom<BlockControllerRuntimeStatus>;
        const initialShellProcStatus = services.BlockService.GetControllerStatus(blockId);
        initialShellProcStatus.then((rts) => {
            this.updateShellProcStatus(rts);
        });
        this.shellProcStatusUnsubFn = waveEventSubscribe({
            eventType: "controllerstatus",
            scope: WOS.makeORef("block", blockId),
            handler: (event) => {
                let bcRTS: BlockControllerRuntimeStatus = event.data;
                this.updateShellProcStatus(bcRTS);
            },
        });
    }

    get viewComponent(): ViewComponent {
        return TsunamiView;
    }

    updateShellProcStatus(fullStatus: BlockControllerRuntimeStatus) {
        console.log("tsunami-status", fullStatus);
        if (fullStatus == null) {
            return;
        }
        const curStatus = globalStore.get(this.shellProcFullStatus);
        if (curStatus == null || curStatus.version < fullStatus.version) {
            globalStore.set(this.shellProcFullStatus, fullStatus);
        }
    }

    triggerRestartAtom() {
        globalStore.set(this.isRestarting, true);
        setTimeout(() => {
            globalStore.set(this.isRestarting, false);
        }, 300);
    }

    resyncController() {
        const prtn = RpcApi.ControllerResyncCommand(TabRpcClient, {
            tabid: globalStore.get(atoms.staticTabId),
            blockid: this.blockId,
            forcerestart: false,
        });
        prtn.catch((e) => console.log("error controller resync", e));
    }

    forceRestartController() {
        if (globalStore.get(this.isRestarting)) {
            return;
        }
        this.triggerRestartAtom();
        const prtn = RpcApi.ControllerResyncCommand(TabRpcClient, {
            tabid: globalStore.get(atoms.staticTabId),
            blockid: this.blockId,
            forcerestart: true,
        });
        prtn.catch((e) => console.log("error controller resync (force restart)", e));
    }

    dispose() {
        if (this.shellProcStatusUnsubFn) {
            this.shellProcStatusUnsubFn();
        }
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const items = super.getSettingsMenuItems();
        // Filter out homepage and navigation-related menu items for tsunami view
        return items.filter((item) => {
            const label = item.label?.toLowerCase() || "";
            return (
                !label.includes("homepage") &&
                !label.includes("home page") &&
                !label.includes("navigation") &&
                !label.includes("nav")
            );
        });
    }
}

const TsunamiView = memo((props: ViewComponentProps<TsunamiViewModel>) => {
    const { model } = props;
    const shellProcFullStatus = jotai.useAtomValue(model.shellProcFullStatus);
    const blockData = jotai.useAtomValue(model.blockAtom);
    const isRestarting = jotai.useAtomValue(model.isRestarting);
    const domReady = jotai.useAtomValue(model.domReady);

    useEffect(() => {
        model.resyncController();
    }, [model]);


    const appPath = blockData?.meta?.["tsunami:apppath"];
    const controller = blockData?.meta?.controller;

    // Check for configuration errors
    const errors = [];
    if (!appPath) {
        errors.push("App path must be set (tsunami:apppath)");
    }
    if (controller !== "tsunami") {
        errors.push("Invalid controller (must be 'tsunami')");
    }

    // Show errors if any exist
    if (errors.length > 0) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                <h1 className="text-4xl font-bold text-main-text-color">Tsunami</h1>
                <div className="flex flex-col gap-2">
                    {errors.map((error, index) => (
                        <div key={index} className="text-sm" style={{ color: "var(--color-error)" }}>
                            {error}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Check if we should show the webview
    const shouldShowWebView =
        shellProcFullStatus?.shellprocstatus === "running" &&
        shellProcFullStatus?.tsunamiport &&
        shellProcFullStatus.tsunamiport !== 0;

    if (shouldShowWebView) {
        const tsunamiUrl = `http://localhost:${shellProcFullStatus.tsunamiport}/?clientid=wave:${model.blockId}`;
        return (
            <div className="w-full h-full">
                <WebView {...props} initialSrc={tsunamiUrl} />
            </div>
        );
    }

    const status = shellProcFullStatus?.shellprocstatus ?? "init";
    const isNotRunning = status === "done" || status === "init";

    return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4">
            <h1 className="text-4xl font-bold text-main-text-color">Tsunami</h1>
            {appPath && <div className="text-sm text-main-text-color opacity-70">{appPath}</div>}
            {isNotRunning && !isRestarting && (
                <button
                    onClick={() => model.forceRestartController()}
                    className="px-4 py-2 bg-accent-color text-primary-text-color rounded hover:bg-accent-color/80 transition-colors cursor-pointer"
                >
                    Start
                </button>
            )}
            {isRestarting && <div className="text-sm text-success-color">Starting...</div>}
        </div>
    );
});

TsunamiView.displayName = "TsunamiView";

export { TsunamiViewModel };
