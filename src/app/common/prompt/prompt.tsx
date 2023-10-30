// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel, LineContainerModel } from "../../../model/model";
import type { LineType, RemoteType, RemotePtrType, LineHeightChangeCallbackType } from "../../../types/types";
import cn from "classnames";
import { isBlank, getRemoteStr } from "../../../util/util";
import { ReactComponent as FolderIcon } from "../../assets/icons/folder.svg";

import "./prompt.less";

dayjs.extend(localizedFormat);

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K, V> = mobx.ObservableMap<K, V>;

type RendererComponentProps = {
    screen: LineContainerModel;
    line: LineType;
    width: number;
    staticRender: boolean;
    visible: OV<boolean>;
    onHeightChange: LineHeightChangeCallbackType;
    collapsed: boolean;
};
type RendererComponentType = {
    new (props: RendererComponentProps): React.Component<RendererComponentProps, {}>;
};

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
    let username = isBlank(rptr.ownerid) ? null : GlobalModel.resolveUserIdToName(rptr.ownerid);
    let remoteRef = GlobalModel.resolveRemoteIdToRef(rptr.remoteid);
    let fullRef = makeFullRemoteRef(username, remoteRef, rptr.name);
    return fullRef;
}

function getShortVEnv(venvDir: string): string {
    if (isBlank(venvDir)) {
        return "";
    }
    let lastSlash = venvDir.lastIndexOf("/");
    if (lastSlash == -1) {
        return venvDir;
    }
    return venvDir.substr(lastSlash + 1);
}

function replaceHomePath(path: string, homeDir: string): string {
    if (path == homeDir) {
        return "~";
    }
    if (path.startsWith(homeDir + "/")) {
        return "~" + path.substr(homeDir.length);
    }
    return path;
}

function getCwdStr(remote: RemoteType, state: Record<string, string>): string {
    if (state == null || isBlank(state.cwd)) {
        return "~";
    }
    let cwd = state.cwd;
    if (remote && remote.remotevars.home) {
        cwd = replaceHomePath(cwd, remote.remotevars.home);
    }
    return cwd;
}

@mobxReact.observer
class Prompt extends React.Component<{ rptr: RemotePtrType; festate: Record<string, string> }, {}> {
    render() {
        let rptr = this.props.rptr;
        if (rptr == null || isBlank(rptr.remoteid)) {
            return <span className={cn("term-prompt", "color-green")}>&nbsp;</span>;
        }
        let remote = GlobalModel.getRemote(this.props.rptr.remoteid);
        let remoteStr = getRemoteStr(rptr);
        let festate = this.props.festate ?? {};
        let cwd = getCwdStr(remote, festate);
        let isRoot = false;
        if (remote && remote.remotevars) {
            if (remote.remotevars["sudo"] || remote.remotevars["bestuser"] == "root") {
                isRoot = true;
            }
        }
        let remoteColorClass = isRoot ? "color-red" : "color-green";
        if (remote && remote.remoteopts && remote.remoteopts.color) {
            remoteColorClass = "color-" + remote.remoteopts.color;
        }
        let remoteTitle: string = null;
        if (remote && remote.remotecanonicalname) {
            remoteTitle = "connected to " + remote.remotecanonicalname;
        }
        let cwdElem = (
            <span title="current directory" className="term-prompt-cwd">
                <FolderIcon className="icon" />
                {cwd}
            </span>
        );
        let remoteElem = (
            <span title={remoteTitle} className={cn("term-prompt-remote", remoteColorClass)}>
                [{remoteStr}]{" "}
            </span>
        );
        let rootIndicatorElem = <span className="term-prompt-end">{isRoot ? "#" : "$"}</span>;
        let branchElem = null;
        let pythonElem = null;
        if (!isBlank(festate["PROMPTVAR_GITBRANCH"])) {
            let branchName = festate["PROMPTVAR_GITBRANCH"];
            branchElem = (
                <span title="current git branch" className="term-prompt-branch">
                    <i className="fa-sharp fa-solid fa-code-branch" />
                    {branchName}{" "}
                </span>
            );
        }
        if (!isBlank(festate["VIRTUAL_ENV"])) {
            let venvDir = festate["VIRTUAL_ENV"];
            let venv = getShortVEnv(venvDir);
            pythonElem = (
                <span title="python venv" className="term-prompt-python">
                    <i className="fa-brands fa-python" />
                    {venv}{" "}
                </span>
            );
        }
        return (
            <span className="term-prompt">
                {remoteElem} {pythonElem}
                {branchElem}
                {cwdElem} {rootIndicatorElem}
            </span>
        );
    }
}

export { Prompt, getRemoteStr };
