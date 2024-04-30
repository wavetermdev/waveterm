// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { genMergeSimpleData, isBlank, ces } from "@/util/util";
import { Model } from "./model";
import { Screen } from "./screen";

class Session {
    sessionId: string;
    name: OV<string>;
    activeScreenId: OV<string>;
    sessionIdx: OV<number>;
    notifyNum: OV<number> = mobx.observable.box(0);
    remoteInstances: OArr<RemoteInstanceType>;
    archived: OV<boolean>;
    globalModel: Model;

    constructor(sdata: SessionDataType, globalModel: Model) {
        this.globalModel = globalModel;
        this.sessionId = sdata.sessionid;
        this.name = mobx.observable.box(sdata.name);
        this.sessionIdx = mobx.observable.box(sdata.sessionidx);
        this.archived = mobx.observable.box(!!sdata.archived);
        this.activeScreenId = mobx.observable.box(ces(sdata.activescreenid));
        let remotes = sdata.remotes || [];
        this.remoteInstances = mobx.observable.array(remotes);
    }

    dispose(): void {}

    // session updates only contain screens (no windows)
    mergeData(sdata: SessionDataType) {
        if (sdata.sessionid != this.sessionId) {
            throw new Error(
                sprintf(
                    "cannot merge session data, sessionids don't match sid=%s, data-sid=%s",
                    this.sessionId,
                    sdata.sessionid
                )
            );
        }
        mobx.action(() => {
            if (!isBlank(sdata.name)) {
                this.name.set(sdata.name);
            }
            if (sdata.sessionidx > 0) {
                this.sessionIdx.set(sdata.sessionidx);
            }
            if (sdata.notifynum >= 0) {
                this.notifyNum.set(sdata.notifynum);
            }
            this.archived.set(!!sdata.archived);
            if (!isBlank(sdata.activescreenid)) {
                let screen = this.getScreenById(sdata.activescreenid);
                if (screen == null) {
                    console.log(
                        sprintf("got session update, activescreenid=%s, screen not found", sdata.activescreenid)
                    );
                } else {
                    this.activeScreenId.set(sdata.activescreenid);
                }
            }
            genMergeSimpleData(this.remoteInstances, sdata.remotes, (r) => r.riid, null);
        })();
    }

    getActiveScreen(): Screen {
        return this.getScreenById(this.activeScreenId.get());
    }

    setActiveScreenId(screenId: string) {
        this.activeScreenId.set(screenId);
    }

    getScreenById(screenId: string): Screen {
        if (screenId == null) {
            return null;
        }
        return this.globalModel.getScreenById(this.sessionId, screenId);
    }

    getRemoteInstance(screenId: string, rptr: RemotePtrType): RemoteInstanceType {
        if (rptr.name.startsWith("*")) {
            screenId = "";
        }
        for (const rdata of this.remoteInstances) {
            if (
                rdata.screenid == screenId &&
                rdata.remoteid == rptr.remoteid &&
                rdata.remoteownerid == rptr.ownerid &&
                rdata.name == rptr.name
            ) {
                return rdata;
            }
        }
        return null;
    }
}

export { Session };
