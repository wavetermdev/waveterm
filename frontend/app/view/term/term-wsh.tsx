// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, globalStore } from "@/app/store/global";
import { makeORef, splitORef } from "@/app/store/wos";
import { RpcResponseHelper, WshClient } from "@/app/store/wshclient";
import { RpcApi } from "@/app/store/wshclientapi";
import { makeFeBlockRouteId } from "@/app/store/wshrouter";
import { TermViewModel } from "@/app/view/term/term";
import { isBlank } from "@/util/util";
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

    async handle_vdomcreatecontext(rh: RpcResponseHelper, data: VDomCreateContext) {
        const source = rh.getSource();
        if (isBlank(source)) {
            throw new Error("source cannot be blank");
        }
        console.log("vdom-create", source, data);
        const tabId = globalStore.get(atoms.staticTabId);
        if (data.target?.newblock) {
            const oref = await RpcApi.CreateBlockCommand(this, {
                tabid: tabId,
                blockdef: {
                    meta: {
                        view: "vdom",
                        "vdom:route": rh.getSource(),
                    },
                },
                magnified: data.target?.magnified,
                focused: true,
            });
            return oref;
        } else if (data.target?.toolbar?.toolbar) {
            const oldVDomBlockId = globalStore.get(this.model.vdomToolbarBlockId);
            console.log("vdom:toolbar", data.target.toolbar);
            globalStore.set(this.model.vdomToolbarTarget, data.target.toolbar);
            const oref = await RpcApi.CreateSubBlockCommand(this, {
                parentblockid: this.blockId,
                blockdef: {
                    meta: {
                        view: "vdom",
                        "vdom:route": rh.getSource(),
                    },
                },
            });
            const [_, newVDomBlockId] = splitORef(oref);
            if (!isBlank(oldVDomBlockId)) {
                // dispose of the old vdom block
                setTimeout(() => {
                    RpcApi.DeleteSubBlockCommand(this, { blockid: oldVDomBlockId });
                }, 500);
            }
            setTimeout(() => {
                RpcApi.SetMetaCommand(this, {
                    oref: makeORef("block", this.model.blockId),
                    meta: {
                        "term:vdomtoolbarblockid": newVDomBlockId,
                    },
                });
            }, 50);
            return oref;
        } else {
            // in the terminal
            // check if there is a current active vdom block
            const oldVDomBlockId = globalStore.get(this.model.vdomBlockId);
            const oref = await RpcApi.CreateSubBlockCommand(this, {
                parentblockid: this.blockId,
                blockdef: {
                    meta: {
                        view: "vdom",
                        "vdom:route": rh.getSource(),
                    },
                },
            });
            const [_, newVDomBlockId] = splitORef(oref);
            if (!isBlank(oldVDomBlockId)) {
                // dispose of the old vdom block
                setTimeout(() => {
                    RpcApi.DeleteSubBlockCommand(this, { blockid: oldVDomBlockId });
                }, 500);
            }
            setTimeout(() => {
                RpcApi.SetMetaCommand(this, {
                    oref: makeORef("block", this.model.blockId),
                    meta: {
                        "term:mode": "vdom",
                        "term:vdomblockid": newVDomBlockId,
                    },
                });
            }, 50);
            return oref;
        }
    }
}
