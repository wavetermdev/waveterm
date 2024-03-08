// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel } from "@/models";
import cn from "classnames";
import { isBlank } from "@/util/util";

import "./prompt.less";

dayjs.extend(localizedFormat);

function makeFullRemoteRef(ownerName: string, remoteRef: string, name: string): string {
    if (isBlank(ownerName) && isBlank(name)) {
        return remoteRef;
    }
    if (!isBlank(ownerName) && isBlank(name)) {
        return ownerName + ":" + remoteRef;
    }
    if (isBlank(ownerName) && !isBlank(name)) {
        return remoteRef + ":" + name;
    }
    return ownerName + ":" + remoteRef + ":" + name;
}

function getRemoteStr(rptr: RemotePtrType): string {
    if (rptr == null || isBlank(rptr.remoteid)) {
        return "(invalid remote)";
    }
    const username = isBlank(rptr.ownerid) ? null : GlobalModel.resolveUserIdToName(rptr.ownerid);
    const remoteRef = GlobalModel.resolveRemoteIdToRef(rptr.remoteid);
    const fullRef = makeFullRemoteRef(username, remoteRef, rptr.name);
    return fullRef;
}

function getShortVEnv(venvDir: string): string {
    if (isBlank(venvDir)) {
        return "";
    }
    const lastSlash = venvDir.lastIndexOf("/");
    if (lastSlash == -1) {
        return venvDir;
    }
    return venvDir.substring(lastSlash + 1);
}

function replaceHomePath(path: string, homeDir: string): string {
    if (path == homeDir) {
        return "~";
    }
    if (path.startsWith(homeDir + "/")) {
        return "~" + path.substring(homeDir.length);
    }
    return path;
}

function getCwdStr(remote: RemoteType, state: Record<string, string>): string {
    if (state == null || isBlank(state.cwd)) {
        return "~";
    }
    let cwd = state.cwd;
    if (remote?.remotevars.home) {
        cwd = replaceHomePath(cwd, remote.remotevars.home);
    }
    return cwd;
}

@mobxReact.observer
class Prompt extends React.Component<{ rptr: RemotePtrType; festate: Record<string, string>; color: boolean }, {}> {
    render() {
        const rptr = this.props.rptr;
        if (rptr == null || isBlank(rptr.remoteid)) {
            return <span className={cn("term-prompt", "color-green")}>&nbsp;</span>;
        }
        const remote = GlobalModel.getRemote(this.props.rptr.remoteid);
        const remoteStr = getRemoteStr(rptr);
        const festate = this.props.festate ?? {};
        const cwd = getCwdStr(remote, festate);
        let isRoot = false;
        if (remote?.remotevars) {
            if (remote.remotevars["sudo"] || remote.remotevars["bestuser"] == "root") {
                isRoot = true;
            }
        }
        let remoteColorClass = isRoot ? "color-red" : "color-green";
        if (remote?.remoteopts?.color) {
            remoteColorClass = "color-" + remote.remoteopts.color;
        }
        let remoteTitle: string = null;
        if (remote?.remotecanonicalname) {
            remoteTitle = "connected to " + remote.remotecanonicalname;
        }
        const cwdElem = <span className="term-prompt-cwd">{cwd}</span>;
        let remoteElem = null;
        if (remoteStr != "local") {
            remoteElem = (
                <span title={remoteTitle} className={cn("term-prompt-remote", remoteColorClass)}>
                    [{remoteStr}]{" "}
                </span>
            );
        }
        let branchElem = null;
        let pythonElem = null;
        let condaElem = null;
        if (!isBlank(festate["PROMPTVAR_GITBRANCH"])) {
            const branchName = festate["PROMPTVAR_GITBRANCH"];
            branchElem = (
                <span title="current git branch" className="term-prompt-branch">
                    git:({branchName}){" "}
                </span>
            );
        }
        if (!isBlank(festate["VIRTUAL_ENV"])) {
            const venvDir = festate["VIRTUAL_ENV"];
            const venv = getShortVEnv(venvDir);
            pythonElem = (
                <span title="python venv" className="term-prompt-python">
                    venv:({venv}){" "}
                </span>
            );
        }
        if (!isBlank(festate["CONDA_DEFAULT_ENV"])) {
            const condaEnv = festate["CONDA_DEFAULT_ENV"];
            condaElem = (
                <span title="conda env" className="term-prompt-python">
                    conda:({condaEnv}){" "}
                </span>
            );
        }
        return (
            <span
                className={cn(
                    "term-prompt",
                    { "term-prompt-color": this.props.color },
                    { "term-prompt-isroot": isRoot }
                )}
            >
                {remoteElem} {cwdElem} {branchElem} {condaElem} {pythonElem}
            </span>
        );
    }
}

export { Prompt, getRemoteStr };
