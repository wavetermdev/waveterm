// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WOS } from "@/app/store/global";
import { RpcResponseHelper, WshClient } from "@/app/store/wshclient";
import { RpcApi } from "@/app/store/wshclientapi";
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
        RpcApi.SetMetaCommand(this, {
            oref: WOS.makeORef("block", this.blockId),
            meta: { "term:mode": "html" },
        });
    }

    handle_vdomasyncinitiation(rh: RpcResponseHelper, data: VDomAsyncInitiationRequest) {
        console.log("async-initiation", rh.getSource(), data);
        this.model.vdomModel.sendRenderRequest(true);
    }
}
