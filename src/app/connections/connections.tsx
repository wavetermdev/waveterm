// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner, RemotesModalModel } from "../../model/model";
import { Toggle, RemoteStatusLight, InfoMessage } from "../common/common";
import * as T from "../../types/types";
import * as util from "../../util/util";
import * as textmeasure from "../../util/textmeasure";

import "./connections.less";

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class ConnectionsView extends React.Component<{ model: RemotesModalModel }, {}> {
    tableRef: React.RefObject<any> = React.createRef();
    tableWidth: OV<number> = mobx.observable.box(0, { name: "tableWidth" });
    tableRszObs: ResizeObserver;

    @boundMethod
    handleSelect(historyId: string) {
        // let hvm = GlobalModel.historyViewModel;
        // mobx.action(() => {
        //     if (hvm.selectedItems.get(historyId)) {
        //         hvm.selectedItems.delete(historyId);
        //     } else {
        //         hvm.selectedItems.set(historyId, true);
        //     }
        // })();
    }

    checkWidth() {
        if (this.tableRef.current != null) {
            mobx.action(() => {
                this.tableWidth.set(this.tableRef.current.offsetWidth);
            })();
        }
    }

    @boundMethod
    handleTableResize() {
        this.checkWidth();
    }

    @boundMethod
    getName(item: T.RemoteType) {
        const { remotealias, remotecanonicalname } = item;
        if (remotealias) {
            return `${remotealias}(${remotecanonicalname})`;
        }
        return remotecanonicalname;
    }

    componentDidMount() {
        if (this.tableRef.current != null) {
            this.tableRszObs = new ResizeObserver(this.handleTableResize.bind(this));
            this.tableRszObs.observe(this.tableRef.current);
        }
        this.checkWidth();
    }

    componentWillUnmount() {
        if (this.tableRszObs != null) {
            this.tableRszObs.disconnect();
        }
    }

    componentDidUpdate() {
        this.checkWidth();
    }

    render() {
        let isHidden = GlobalModel.activeMainView.get() != "connections";
        if (isHidden) {
            return null;
        }

        let model = this.props.model;
        let selectedRemoteId = model.selectedRemoteId.get();
        let items = util.sortAndFilterRemotes(GlobalModel.remotes.slice());
        console.log("items", items);
        let remote: T.RemoteType = null;
        let isAuthEditMode = model.isAuthEditMode();
        let selectedRemote = GlobalModel.getRemote(selectedRemoteId);
        let remoteEdit = model.remoteEdit.get();
        let onlyAddNewRemote = model.onlyAddNewRemote.get();

        return (
            <div className={cn("connections-view")}>
                <div className="header">
                    <div className="connections-title text-standard">Connections</div>
                </div>
                <table className="connections-table" cellSpacing="0" cellPadding="0" border={0} ref={this.tableRef}>
                    <thead>
                        <tr>
                            <th className="text-standard" colSpan={6}>
                                <div>Name</div>
                            </th>
                            <th className="text-standard" colSpan={6}>
                                <div>Type</div>
                            </th>
                            <th className="text-standard" colSpan={6}>
                                <div>Status</div>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <For index="idx" each="item" of={items}>
                            <tr key={item.remoteid} className="connections-item">
                                <td colSpan={6}>
                                    <div>{this.getName(item)}</div>
                                </td>
                                <td colSpan={6}>
                                    <div>{item.remotetype}</div>
                                </td>
                                <td colSpan={6}>
                                    <div>{item.status}</div>
                                </td>
                            </tr>
                        </For>
                    </tbody>
                </table>
                <If condition={items.length == 0}>
                    <div className="no-items">
                        <div>No Connections Items Found</div>
                    </div>
                </If>
            </div>
        );
    }
}

export { ConnectionsView };
