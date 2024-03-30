// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-preact";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import cn from "classnames";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel } from "@/models";
import { isBlank } from "@/util/util";

dayjs.extend(localizedFormat);

const TDots = "⋮";

function truncateWithTDots(str: string, maxLen: number): string {
    if (str == null) {
        return null;
    }
    if (str.length <= maxLen) {
        return str;
    }
    return str.slice(0, maxLen - 1) + TDots;
}

@mobxReact.observer
class HItem extends React.PureComponent<
    {
        hitem: HistoryItem;
        isSelected: boolean;
        opts: HistoryQueryOpts;
        snames: Record<string, string>;
        scrNames: Record<string, string>;
        onClick: (hitem: HistoryItem) => void;
    },
    {}
> {
    renderRemote(hitem: HistoryItem): any {
        if (hitem.remote == null || isBlank(hitem.remote.remoteid)) {
            return sprintf("%-15s ", "");
        }
        let r = GlobalModel.getRemote(hitem.remote.remoteid);
        if (r == null) {
            return sprintf("%-15s ", "???");
        }
        let rname = "";
        if (!isBlank(r.remotealias)) {
            rname = r.remotealias;
        } else {
            rname = r.remotecanonicalname;
        }
        if (!isBlank(hitem.remote.name)) {
            rname = rname + ":" + hitem.remote.name;
        }
        let rtn = sprintf("%-15s ", "[" + truncateWithTDots(rname, 13) + "]");
        return rtn;
    }

    renderHInfoText(
        hitem: HistoryItem,
        opts: HistoryQueryOpts,
        isSelected: boolean,
        snames: Record<string, string>,
        scrNames: Record<string, string>
    ): string {
        let remoteStr = "";
        if (!opts.limitRemote) {
            remoteStr = this.renderRemote(hitem);
        }
        let selectedStr = isSelected ? "*" : " ";
        let lineNumStr = hitem.linenum > 0 ? "(" + hitem.linenum + ")" : "";
        if (isBlank(opts.queryType) || opts.queryType == "screen") {
            return selectedStr + sprintf("%7s", lineNumStr) + " " + remoteStr;
        }
        if (opts.queryType == "session") {
            let screenStr = "";
            if (!isBlank(hitem.screenid)) {
                let scrName = scrNames[hitem.screenid];
                if (scrName != null) {
                    screenStr = "[" + truncateWithTDots(scrName, 15) + "]";
                }
            }
            return selectedStr + sprintf("%17s", screenStr) + sprintf("%7s", lineNumStr) + " " + remoteStr;
        }
        if (opts.queryType == "global") {
            let sessionStr = "";
            if (!isBlank(hitem.sessionid)) {
                let sessionName = snames[hitem.sessionid];
                if (sessionName != null) {
                    sessionStr = "#" + truncateWithTDots(sessionName, 15);
                }
            }
            let screenStr = "";
            if (!isBlank(hitem.screenid)) {
                let scrName = scrNames[hitem.screenid];
                if (scrName != null) {
                    screenStr = "[" + truncateWithTDots(scrName, 13) + "]";
                }
            }
            let ssStr = sessionStr + screenStr;
            return (
                selectedStr +
                sprintf("%15s ", sessionStr) +
                " " +
                sprintf("%15s", screenStr) +
                sprintf("%7s", lineNumStr) +
                " " +
                remoteStr
            );
        }
        return "-";
    }

    render() {
        let { hitem, isSelected, opts, snames, scrNames } = this.props;
        let lines = hitem.cmdstr.split("\n");
        let line: string = "";
        let idx = 0;
        let infoText = this.renderHInfoText(hitem, opts, isSelected, snames, scrNames);
        let infoTextSpacer = sprintf("%" + infoText.length + "s", "");
        return (
            <div
                key={hitem.historynum}
                className={cn(
                    "history-item",
                    { "is-selected": isSelected },
                    { "history-haderror": hitem.haderror },
                    "hnum-" + hitem.historynum
                )}
                onClick={() => this.props.onClick(hitem)}
            >
                <div className="history-line">
                    {infoText} {lines[0]}
                </div>
                <For each="line" index="idx" of={lines.slice(1)}>
                    <div key={idx} className="history-line">
                        {infoTextSpacer} {line}
                    </div>
                </For>
            </div>
        );
    }
}

@mobxReact.observer
class HistoryInfo extends React.PureComponent<{}, {}> {
    lastClickHNum: string = null;
    lastClickTs: number = 0;
    containingText: mobx.IObservableValue<string> = mobx.observable.box("");

    componentDidMount() {
        let inputModel = GlobalModel.inputModel;
        let hitem = inputModel.getHistorySelectedItem();
        if (hitem == null) {
            hitem = inputModel.getFirstHistoryItem();
        }
        if (hitem != null) {
            inputModel.scrollHistoryItemIntoView(hitem.historynum);
        }
    }

    @boundMethod
    handleClose() {
        GlobalModel.inputModel.toggleInfoMsg();
    }

    @boundMethod
    handleItemClick(hitem: HistoryItem) {
        let inputModel = GlobalModel.inputModel;
        let selItem = inputModel.getHistorySelectedItem();
        if (this.lastClickHNum == hitem.historynum && selItem != null && selItem.historynum == hitem.historynum) {
            inputModel.grabSelectedHistoryItem();
            return;
        }
        inputModel.giveFocus();
        inputModel.setHistorySelectionNum(hitem.historynum);
        let now = Date.now();
        this.lastClickHNum = hitem.historynum;
        this.lastClickTs = now;
        setTimeout(() => {
            if (this.lastClickTs == now) {
                this.lastClickHNum = null;
                this.lastClickTs = 0;
            }
        }, 3000);
    }

    @boundMethod
    handleClickType() {
        let inputModel = GlobalModel.inputModel;
        inputModel.toggleHistoryType();
    }

    @boundMethod
    handleClickRemote() {
        let inputModel = GlobalModel.inputModel;
        inputModel.toggleRemoteType();
    }

    render() {
        let inputModel = GlobalModel.inputModel;
        let idx: number = 0;
        let selItem = inputModel.getHistorySelectedItem();
        let hitems = inputModel.getFilteredHistoryItems();
        hitems = hitems.slice().reverse();
        let hitem: HistoryItem = null;
        let opts = inputModel.historyQueryOpts.get();
        let snames: Record<string, string> = {};
        let scrNames: Record<string, string> = {};
        if (opts.queryType == "global") {
            scrNames = GlobalModel.getScreenNames();
            snames = GlobalModel.getSessionNames();
        } else if (opts.queryType == "session") {
            scrNames = GlobalModel.getScreenNames();
        }
        return (
            <div className="cmd-history hide-scrollbar">
                <div className="cmdinput-titlebar history-title">
                    <div className="title-icon">
                        <i className="fa-sharp fa-solid fa-clock-rotate-left" />
                    </div>
                    <div className="title-string">History</div>
                    <div className="spacer"></div>
                    <div className="history-opt history-clickable-opt" onClick={this.handleClickType}>
                        [for {opts.queryType} &#x2318;S]
                    </div>
                    <div className="spacer"></div>
                    <div className="history-opt" title="type to search">
                        [containing '{opts.queryStr}']
                    </div>
                    <div className="spacer"></div>
                    <div className="history-opt history-clickable-opt" onClick={this.handleClickRemote}>
                        [{opts.limitRemote ? "this" : "any"} remote &#x2318;R]
                    </div>
                    <div className="flex-spacer"></div>
                    <div className="close-button" title="Close (ESC)">
                        <i className="fa-sharp fa-solid fa-xmark-large" onClick={this.handleClose}></i>
                    </div>
                </div>
                <div
                    className={cn(
                        "history-items",
                        { "show-remotes": !opts.limitRemote },
                        { "show-sessions": opts.queryType == "global" }
                    )}
                >
                    <div className="titlebar-spacer" />
                    <If condition={hitems.length == 0}>[no history]</If>
                    <If condition={hitems.length > 0}>
                        <For each="hitem" index="idx" of={hitems}>
                            <HItem
                                key={hitem.historyid}
                                hitem={hitem}
                                isSelected={hitem == selItem}
                                opts={opts}
                                snames={snames}
                                scrNames={scrNames}
                                onClick={this.handleItemClick}
                            ></HItem>
                        </For>
                    </If>
                </div>
            </div>
        );
    }
}

export { HistoryInfo };
