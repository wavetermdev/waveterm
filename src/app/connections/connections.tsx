// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import cn from "classnames";
import { GlobalModel, RemotesModel, GlobalCommandRunner } from "../../model/model";
import { Button, IconButton, Status } from "../common/common";
import * as T from "../../types/types";
import * as util from "../../util/util";

import "./connections.less";

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class ConnectionsView extends React.Component<{ model: RemotesModel }, { hoveredItemId: string }> {
    tableRef: React.RefObject<any> = React.createRef();
    tableWidth: OV<number> = mobx.observable.box(0, { name: "tableWidth" });
    tableRszObs: ResizeObserver;

    constructor(props) {
        super(props);
        this.state = {
            hoveredItemId: null,
        };
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
    handleItemHover(remoteId: string) {
        this.setState({ hoveredItemId: remoteId });
    }

    @boundMethod
    handleTableHoverLeave() {
        this.setState({ hoveredItemId: null });
    }

    @boundMethod
    getName(item: T.RemoteType) {
        const { remotealias, remotecanonicalname } = item;
        return remotealias ? `${remotealias} [${remotecanonicalname}]` : remotecanonicalname;
    }

    @boundMethod
    handleAddConnection(): void {
        GlobalModel.remotesModel.openAddModal({ remoteedit: true });
    }

    @boundMethod
    handleRead(remoteId: string): void {
        GlobalModel.remotesModel.openReadModal(remoteId);
    }

    @boundMethod
    handleArchive(remoteId: string): void {
        let remote = GlobalModel.getRemote(remoteId);
        if (remote.status == "connected") {
            GlobalModel.showAlert({ message: "Cannot archived a connected remote.  Disconnect and try again." });
            return;
        }
        let prtn = GlobalModel.showAlert({
            message: "Are you sure you want to archive this connection?",
            confirm: true,
        });
        prtn.then((confirm) => {
            if (!confirm) {
                return;
            }
            GlobalCommandRunner.archiveRemote(remote.remoteid);
        });
    }

    @boundMethod
    getStatus(status: string) {
        switch (status) {
            case "connected":
                return "green";
            case "disconnected":
                return "gray";
            default:
                return "red";
        }
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

        let items = util.sortAndFilterRemotes(GlobalModel.remotes.slice());
        let remote = this.props.model.selectedRemoteId.get();

        return (
            <div className={cn("connections-view")}>
                <header className="header">
                    <div className="connections-title text-primary">Connections</div>
                </header>
                <table
                    className="connections-table"
                    cellSpacing="0"
                    cellPadding="0"
                    border={0}
                    ref={this.tableRef}
                    onMouseLeave={this.handleTableHoverLeave}
                    style={{ maxWidth: 650 + 120 + 200 + 100 }}
                >
                    <colgroup>
                        <col style={{ maxWidth: 650 }} />
                        <col style={{ width: 120 }} />
                        <col style={{ width: 200 }} />
                        <col style={{ width: 100 }} />
                    </colgroup>
                    <thead>
                        <tr>
                            <th className="text-standard col-name">
                                <div>Name</div>
                            </th>
                            <th className="text-standard col-type">
                                <div>Type</div>
                            </th>
                            <th className="text-standard col-status">
                                <div>Status</div>
                            </th>
                            <th className="text-standard col-actions" style={{ width: "1%" }}>
                                {" "}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <For index="idx" each="item" of={items}>
                            <tr
                                key={item.remoteid}
                                className={cn("connections-item", {
                                    hovered: this.state.hoveredItemId === item.remoteid,
                                })}
                                onMouseEnter={() => this.handleItemHover(item.remoteid)}
                            >
                                <td className="col-name">
                                    <div>{this.getName(item)}</div>
                                </td>
                                <td className="col-type">
                                    <div>{item.remotetype}</div>
                                </td>
                                <td className="col-status">
                                    <div>
                                        <Status status={this.getStatus(item.status)} text={item.status} />
                                    </div>
                                </td>
                                <td style={{ whiteSpace: "nowrap" }} className="col-actions">
                                    <div className="action-buttons">
                                        <IconButton
                                            theme="secondary"
                                            variant="ghost"
                                            onClick={() => this.handleRead(item.remoteid)}
                                        >
                                            <i className="fa-sharp fa-solid fa-magnifying-glass"></i>
                                        </IconButton>
                                        <IconButton
                                            theme="secondary"
                                            variant="ghost"
                                            onClick={() => this.handleArchive(item.remoteid)}
                                        >
                                            <i className="fa-sharp fa-solid fa-trash-can"></i>
                                        </IconButton>
                                    </div>
                                </td>
                            </tr>
                        </For>
                    </tbody>
                </table>
                <footer>
                    <Button
                        theme="secondary"
                        leftIcon={<i className="fa-sharp fa-solid fa-plus"></i>}
                        onClick={this.handleAddConnection}
                    >
                        New Connection
                    </Button>
                </footer>
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
