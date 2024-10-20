// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/global";
import { waveEventSubscribe } from "@/app/store/wps";
import { RpcResponseHelper, WshClient } from "@/app/store/wshclient";
import { makeFeBlockRouteId } from "@/app/store/wshrouter";
import { TermViewModel } from "@/app/view/term/term";
import debug from "debug";

const dlog = debug("wave:vdom");

export class TermWshClient extends WshClient {
    blockId: string;
    model: TermViewModel;

    constructor(blockId: string, model: TermViewModel) {
        super(makeFeBlockRouteId(blockId));
        this.blockId = blockId;
        this.model = model;
    }

    handle_vdomcreatecontext(rh: RpcResponseHelper, data: VDomCreateContext) {
        console.log("vdom-create", rh.getSource(), data);
        this.model.vdomModel.reset();
        this.model.vdomModel.backendRoute = rh.getSource();
        globalStore.set(this.model.vdomModel.contextActive, true);
        if (!data.persist) {
            const unsubFn = waveEventSubscribe({
                eventType: "route:gone",
                scope: rh.getSource(),
                handler: () => {
                    globalStore.set(this.model.vdomModel.contextActive, false);
                    this.model.setTermMode("term");
                    unsubFn();
                },
            });
        }
        this.model.setTermMode("html");
        this.model.vdomModel.queueUpdate(true);
    }

    handle_vdomasyncinitiation(rh: RpcResponseHelper, data: VDomAsyncInitiationRequest) {
        console.log("async-initiation", rh.getSource(), data);
        this.model.vdomModel.queueUpdate(true);
    }
}
