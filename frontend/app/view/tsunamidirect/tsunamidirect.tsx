// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore, WOS } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WebView, WebViewModel } from "@/app/view/webview/webview";
import { stringToBase64 } from "@/util/util";
import * as jotai from "jotai";
import { memo, useEffect } from "react";

class TsunamiDirectViewModel extends WebViewModel {
    appMeta: jotai.PrimitiveAtom<AppMeta>;
    viewIcon: jotai.Atom<IconButtonDecl>;
    viewName: jotai.Atom<string>;
    tsunamiUrl: string;
    parentBlockId: string;

    constructor(initOpts: ViewModelInitType) {
        super(initOpts);
        this.viewType = "tsunamidirect";
        this.hideNav = jotai.atom(true);
        this.hideViewName = jotai.atom(false);
        this.partitionOverride = jotai.atom(`tsunami:${this.blockId}`);

        const blockData = globalStore.get(this.blockAtom);
        this.tsunamiUrl = blockData?.meta?.["tsunami:url"] ?? "";
        this.parentBlockId = blockData?.meta?.["tsunami:parentblockid"] ?? "";

        this.appMeta = jotai.atom(null) as jotai.PrimitiveAtom<AppMeta>;
        this.viewIcon = jotai.atom((get) => {
            const meta = get(this.appMeta);
            const icon = meta?.icon || "cube";
            const iconColor = meta?.iconcolor;
            return {
                elemtype: "iconbutton" as const,
                icon,
                iconColor,
            };
        });
        this.viewName = jotai.atom((get) => {
            const meta = get(this.appMeta);
            return meta?.title || "WaveApp";
        });

        if (this.tsunamiUrl) {
            fetch(`${this.tsunamiUrl}/api/manifest`)
                .then((r) => r.json())
                .then((manifest: AppManifest) => {
                    if (manifest?.appmeta) {
                        globalStore.set(this.appMeta, manifest.appmeta);
                    }
                })
                .catch(() => {});
        }

    }

    get viewComponent(): ViewComponent {
        return TsunamiDirectView;
    }

    giveFocus(): boolean {
        this.webviewRef.current?.focus();
        return true;
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const items = super.getSettingsMenuItems();
        return items.filter((item) => {
            const label = item.label?.toLowerCase() || "";
            return label === "copy url to clipboard" || label === "set zoom factor" || label.includes("devtools");
        });
    }

    getPromotedContextMenuItems(): ContextMenuItem[] {
        return this.getSettingsMenuItems();
    }
}

const TsunamiDirectView = memo((props: ViewComponentProps<TsunamiDirectViewModel>) => {
    const { model } = props;
    const domReady = jotai.useAtomValue(model.domReady);

    const { tsunamiUrl, parentBlockId } = model;
    const initialSrc = tsunamiUrl ? `${tsunamiUrl}/?clientid=wave:${model.blockId}` : "";

    useEffect(() => {
        if (!domReady || !parentBlockId || !model.webviewRef.current) return;
        const webview = model.webviewRef.current;
        webview.send("enable-tsunami-termlisten", parentBlockId);
        const handler = (event: any) => {
            if (event.channel !== "tsunami-key") return;
            const { key } = event.args[0];
            if (key === "cmd-escape") {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", parentBlockId),
                    meta: { "term:mode": null },
                });
                return;
            }
            let inputData: string | null = null;
            if (key === "ctrl-c") inputData = "\x03";
            else if (key === "ctrl-z") inputData = "\x1a";
            if (!inputData) return;
            RpcApi.ControllerInputCommand(TabRpcClient, {
                blockid: parentBlockId,
                inputdata64: stringToBase64(inputData),
            });
        };
        webview.addEventListener("ipc-message", handler);
        return () => {
            webview.removeEventListener("ipc-message", handler);
        };
    }, [domReady, parentBlockId]);

    if (!tsunamiUrl) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <div className="text-sm opacity-60">No tsunami URL configured (tsunami:url)</div>
            </div>
        );
    }

    return (
        <div className="w-full h-full">
            <WebView {...props} initialSrc={initialSrc} />
        </div>
    );
});

TsunamiDirectView.displayName = "TsunamiDirectView";

export { TsunamiDirectViewModel };
