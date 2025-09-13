// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { atoms, globalStore, WOS } from "@/app/store/global";
import { waveEventSubscribe } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import * as services from "@/store/services";
import * as jotai from "jotai";
import { memo } from "react";

class TsunamiViewModel implements ViewModel {
    viewType: string;
    blockAtom: jotai.Atom<Block>;
    blockId: string;
    viewIcon: jotai.Atom<string>;
    viewName: jotai.Atom<string>;
    shellProcFullStatus: jotai.PrimitiveAtom<BlockControllerRuntimeStatus>;
    shellProcStatusUnsubFn: () => void;
    isRestarting: jotai.PrimitiveAtom<boolean>;

    constructor(blockId: string, nodeModel: BlockNodeModel) {
        this.viewType = "tsunami";
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = jotai.atom("cube");
        this.viewName = jotai.atom("Tsunami");
        this.isRestarting = jotai.atom(false);

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
        return [];
    }
}

type TsunamiViewProps = {
    model: TsunamiViewModel;
};

const TsunamiView = memo(({ model }: TsunamiViewProps) => {
    const shellProcFullStatus = jotai.useAtomValue(model.shellProcFullStatus);
    const blockData = jotai.useAtomValue(model.blockAtom);
    const isRestarting = jotai.useAtomValue(model.isRestarting);

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

    // Check if we should show the iframe
    const shouldShowIframe =
        shellProcFullStatus?.shellprocstatus === "running" &&
        shellProcFullStatus?.tsunamiport &&
        shellProcFullStatus.tsunamiport !== 0;

    if (shouldShowIframe) {
        const iframeUrl = `http://localhost:${shellProcFullStatus.tsunamiport}/?clientid=wave:${model.blockId}`;
        return <iframe src={iframeUrl} className="w-full h-full border-0" title="Tsunami Application" />;
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
