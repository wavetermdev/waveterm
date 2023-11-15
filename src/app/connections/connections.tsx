// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import cn from "classnames";
import { GlobalModel, RemotesModel } from "../../model/model";
import { Button, IconButton, Status } from "../common/common";
import * as T from "../../types/types";
import * as util from "../../util/util";

import "./connections.less";

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class ConnectionsView extends React.Component<{ model: RemotesModel }, {}> {
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
        return remotealias ? `${remotealias}(${remotecanonicalname})` : remotecanonicalname;
    }

    @boundMethod
    handleAddConnection(): void {
        GlobalModel.remotesModel.openAddModal({ remoteedit: true });
    }

    @boundMethod
    handleReadConnection(remoteId: string): void {
        console.log("remoteId", remoteId);
        GlobalModel.remotesModel.openReadModal(remoteId);
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

        let model = this.props.model;
        let selectedRemoteId = model.selectedRemoteId.get();
        let items = util.sortAndFilterRemotes(GlobalModel.remotes.slice());
        console.log("items", items);
        // let remote: T.RemoteType = null;
        // let isAuthEditMode = model.isAuthEditMode();
        // let selectedRemote = GlobalModel.getRemote(selectedRemoteId);
        // let remoteEdit = model.remoteEdit.get();
        // let onlyAddNewRemote = model.onlyAddNewRemote.get();

        return (
            <div className={cn("connections-view")}>
                <div className="header">
                    <div className="connections-title text-standard">Connections</div>
                    <div>
                        <Button
                            theme="secondary"
                            leftIcon={<i className="fa-sharp fa-solid fa-plus"></i>}
                            onClick={this.handleAddConnection}
                        >
                            New Connection
                        </Button>
                    </div>
                </div>
                <table
                    className="connections-table"
                    cellSpacing="0"
                    cellPadding="0"
                    border={0}
                    ref={this.tableRef}
                    onMouseLeave={this.handleTableHoverLeave}
                >
                    <thead>
                        <tr>
                            <th className="text-standard" colSpan={2}>
                                <div>Name</div>
                            </th>
                            <th className="text-standard">
                                <div>Type</div>
                            </th>
                            <th className="text-standard">
                                <div>Status</div>
                            </th>
                            <th className="text-standard" style={{ width: "1%" }}>
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
                                <td colSpan={2}>
                                    <div>{this.getName(item)}</div>
                                </td>
                                <td>
                                    <div>{item.remotetype}</div>
                                </td>
                                <td>
                                    <div>
                                        <Status status={this.getStatus(item.status)} text={item.status} />
                                    </div>
                                </td>
                                <td style={{ whiteSpace: "nowrap" }}>
                                    <div className="action-buttons">
                                        <IconButton
                                            theme="secondary"
                                            variant="ghost"
                                            onClick={() => this.handleReadConnection(item.remoteid)}
                                        >
                                            <i className="fa-sharp fa-solid fa-magnifying-glass"></i>
                                        </IconButton>
                                        <IconButton theme="secondary" variant="ghost">
                                            <i className="fa-sharp fa-solid fa-trash-can"></i>
                                        </IconButton>
                                    </div>
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
