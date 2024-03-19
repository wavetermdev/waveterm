// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { If, For } from "tsx-control-statements/components";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner, Cmd } from "@/models";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { Line } from "@/app/line/linecomps";
import { checkKeyPressed, adaptFromReactOrNativeKeyEvent } from "@/util/keyutil";
import { TextField, Dropdown, Button, DatePicker } from "@/elements";

import { ReactComponent as AngleDownIcon } from "@/assets/icons/history/angle-down.svg";
import { ReactComponent as ChevronLeftIcon } from "@/assets/icons/history/chevron-left.svg";
import { ReactComponent as ChevronRightIcon } from "@/assets/icons/history/chevron-right.svg";
import { ReactComponent as RightIcon } from "@/assets/icons/history/right.svg";
import { ReactComponent as SearchIcon } from "@/assets/icons/history/search.svg";
import { ReactComponent as TrashIcon } from "@/assets/icons/trash.svg";
import { ReactComponent as CheckedCheckbox } from "@/assets/icons/checked-checkbox.svg";
import { ReactComponent as CheckIcon } from "@/assets/icons/line/check.svg";
import { ReactComponent as CopyIcon } from "@/assets/icons/history/copy.svg";

import "./history.less";
import { MainView } from "../common/elements/mainview";

dayjs.extend(customParseFormat);
dayjs.extend(localizedFormat);

function isBlank(s: string) {
    return s == null || s == "";
}

function getHistoryViewTs(nowDate: Date, ts: number): string {
    let itemDate = new Date(ts);
    if (nowDate.getFullYear() != itemDate.getFullYear()) {
        return dayjs(itemDate).format("M/D/YY");
    } else if (nowDate.getMonth() != itemDate.getMonth() || nowDate.getDate() != itemDate.getDate()) {
        return dayjs(itemDate).format("MMM D");
    } else {
        return dayjs(itemDate).format("h:mm A");
    }
}

function formatRemoteName(rnames: Record<string, string>, rptr: RemotePtrType): string {
    if (rptr == null || isBlank(rptr.remoteid)) {
        return "";
    }
    let rname = rnames[rptr.remoteid];
    if (rname == null) {
        rname = rptr.remoteid.substr(0, 8);
    }
    if (!isBlank(rptr.name)) {
        rname = rname + ":" + rptr.name;
    }
    return "[" + rname + "]";
}

function formatSSName(snames: Record<string, string>, scrnames: Record<string, string>, item: HistoryItem): string {
    if (isBlank(item.sessionid)) {
        return "";
    }
    let sessionName = "#" + (snames[item.sessionid] ?? item.sessionid.substr(0, 8));
    if (isBlank(item.screenid)) {
        return sessionName;
    }
    // let screenName = "/" + (scrnames[item.screenid] ?? item.screenid.substr(0, 8));
    // return sessionName + screenName;
    return sessionName;
}

function formatSessionName(snames: Record<string, string>, sessionId: string): string {
    if (isBlank(sessionId)) {
        return "";
    }
    let sname = snames[sessionId];
    if (sname == null) {
        return sessionId.substr(0, 8);
    }
    return "#" + sname;
}

@mobxReact.observer
class HistoryCheckbox extends React.Component<{ checked: boolean; partialCheck?: boolean; onClick?: () => void }, {}> {
    @boundMethod
    clickHandler(): void {
        if (this.props.onClick) {
            this.props.onClick();
        }
    }

    render() {
        if (this.props.checked) {
            return <CheckedCheckbox onClick={this.clickHandler} className="history-checkbox checkbox-icon" />;
        }
        if (this.props.partialCheck) {
            return (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="0.5" y="0.5" width="15" height="15" rx="3.5" fill="#D5FEAF" fill-opacity="0.026" />
                    <path
                        fill-rule="evenodd"
                        clip-rule="evenodd"
                        d="M4 8C4 6.89543 4.89543 6 6 6H10C11.1046 6 12 6.89543 12 8C12 9.10457 11.1046 10 10 10H6C4.89543 10 4 9.10457 4 8Z"
                        fill="#58C142"
                    />
                    <rect x="0.5" y="0.5" width="15" height="15" rx="3.5" stroke="#3B3F3A" />
                </svg>
            );
        } else {
            return <div onClick={this.clickHandler} className="history-checkbox state-unchecked" />;
        }
    }
}

class HistoryCmdStr extends React.Component<
    {
        cmdstr: string;
        onUse: () => void;
        onCopy: () => void;
        isCopied: boolean;
        fontSize: "normal" | "large";
        limitHeight: boolean;
    },
    {}
> {
    @boundMethod
    handleUse(e: any) {
        e.stopPropagation();
        if (this.props.onUse != null) {
            this.props.onUse();
        }
    }

    @boundMethod
    handleCopy(e: any) {
        e.stopPropagation();
        if (this.props.onCopy != null) {
            this.props.onCopy();
        }
    }

    render() {
        let { isCopied, cmdstr, fontSize, limitHeight } = this.props;
        return (
            <div className={cn("cmdstr-code", { "is-large": fontSize == "large" }, { "limit-height": limitHeight })}>
                <If condition={isCopied}>
                    <div key="copied" className="copied-indicator">
                        <div>copied</div>
                    </div>
                </If>
                <div key="code" className="code-div">
                    <code>{cmdstr}</code>
                </div>
                <div key="copy" className="actions-block">
                    <div className="action-item" onClick={this.handleCopy} title="copy">
                        <CopyIcon className="icon" />
                    </div>
                    <div key="use" className="action-item" title="Use Command" onClick={this.handleUse}>
                        <CheckIcon className="icon" />
                    </div>
                </div>
            </div>
        );
    }
}

class HistoryKeybindings extends React.Component<{}, {}> {
    @boundMethod
    componentDidMount() {
        let historyViewModel = GlobalModel.historyViewModel;
        let keybindManager = GlobalModel.keybindManager;
        keybindManager.registerKeybinding("mainview", "history", "generic:cancel", (waveEvent) => {
            historyViewModel.handleUserClose();
            return true;
        });
    }

    @boundMethod
    componentWillUnmount() {
        GlobalModel.keybindManager.unregisterDomain("history");
    }

    render() {
        return null;
    }
}

@mobxReact.observer
class HistoryView extends React.Component<{}, {}> {
    tableRef: React.RefObject<any> = React.createRef();
    tableWidth: OV<number> = mobx.observable.box(0, { name: "tableWidth" });
    tableRszObs: ResizeObserver;
    sessionDropdownActive: OV<boolean> = mobx.observable.box(false, { name: "sessionDropdownActive" });
    remoteDropdownActive: OV<boolean> = mobx.observable.box(false, { name: "remoteDropdownActive" });
    copiedItemId: OV<string> = mobx.observable.box(null, { name: "copiedItemId" });

    @boundMethod
    handleNext() {
        GlobalModel.historyViewModel.goNext();
    }

    @boundMethod
    handlePrev() {
        GlobalModel.historyViewModel.goPrev();
    }

    @boundMethod
    changeSearchText(val: string) {
        mobx.action(() => {
            GlobalModel.historyViewModel.searchText.set(val);
        })();
    }

    @boundMethod
    searchKeyDown(e: any) {
        let waveEvent = adaptFromReactOrNativeKeyEvent(e);
        if (checkKeyPressed(waveEvent, "Enter")) {
            e.preventDefault();
            GlobalModel.historyViewModel.submitSearch();
        }
    }

    @boundMethod
    handleSelect(historyId: string) {
        let hvm = GlobalModel.historyViewModel;
        mobx.action(() => {
            if (hvm.selectedItems.get(historyId)) {
                hvm.selectedItems.delete(historyId);
            } else {
                hvm.selectedItems.set(historyId, true);
            }
        })();
    }

    @boundMethod
    handleControlCheckbox() {
        let hvm = GlobalModel.historyViewModel;
        mobx.action(() => {
            let numSelected = hvm.selectedItems.size;
            if (numSelected > 0) {
                hvm.selectedItems.clear();
            } else {
                for (const element of hvm.items) {
                    hvm.selectedItems.set(element.historyid, true);
                }
            }
        })();
    }

    @boundMethod
    handleClickDelete() {
        GlobalModel.historyViewModel.doSelectedDelete();
    }

    @boundMethod
    activateItem(historyId: string) {
        if (GlobalModel.historyViewModel.activeItem.get() == historyId) {
            GlobalModel.historyViewModel.setActiveItem(null);
        } else {
            GlobalModel.historyViewModel.setActiveItem(historyId);
        }
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

    searchFromTsInputValue(): string {
        let hvm = GlobalModel.historyViewModel;
        let fromDate = hvm.searchFromDate.get();
        if (fromDate == null) {
            return dayjs().format("YYYY-MM-DD");
        }
        return fromDate;
    }

    @boundMethod
    handleFromTsChange(date: Date): void {
        let hvm = GlobalModel.historyViewModel;
        let newDate = dayjs(date).format("YYYY-MM-DD");
        let today = dayjs().format("YYYY-MM-DD");
        if (newDate == "" || newDate == today) {
            hvm.setFromDate(null);
            return;
        }
        console.log;
        hvm.setFromDate(newDate);
    }

    @boundMethod
    toggleSessionDropdown(): void {
        mobx.action(() => {
            this.sessionDropdownActive.set(!this.sessionDropdownActive.get());
            if (this.sessionDropdownActive.get()) {
                this.remoteDropdownActive.set(false);
            }
        })();
    }

    @boundMethod
    clickLimitSession(sessionId: string): void {
        let hvm = GlobalModel.historyViewModel;
        mobx.action(() => {
            this.sessionDropdownActive.set(false);
            hvm.setSearchSessionId(sessionId);
        })();
    }

    @boundMethod
    toggleRemoteDropdown(): void {
        mobx.action(() => {
            this.remoteDropdownActive.set(!this.remoteDropdownActive.get());
            if (this.remoteDropdownActive.get()) {
                this.sessionDropdownActive.set(false);
            }
        })();
    }

    @boundMethod
    clickLimitRemote(remoteId: string): void {
        let hvm = GlobalModel.historyViewModel;
        mobx.action(() => {
            this.remoteDropdownActive.set(false);
            hvm.setSearchRemoteId(remoteId);
        })();
    }

    @boundMethod
    toggleShowMeta(): void {
        let hvm = GlobalModel.historyViewModel;
        mobx.action(() => {
            hvm.setSearchShowMeta(!hvm.searchShowMeta.get());
        })();
    }

    @boundMethod
    toggleFilterCmds(): void {
        let hvm = GlobalModel.historyViewModel;
        mobx.action(() => {
            hvm.setSearchFilterCmds(!hvm.searchFilterCmds.get());
        })();
    }

    @boundMethod
    resetAllFilters(): void {
        let hvm = GlobalModel.historyViewModel;
        hvm.resetAllFilters();
    }

    @boundMethod
    handleCopy(item: HistoryItem): void {
        if (isBlank(item.cmdstr)) {
            return;
        }
        navigator.clipboard.writeText(item.cmdstr);
        mobx.action(() => {
            this.copiedItemId.set(item.historyid);
        })();
        setTimeout(() => {
            mobx.action(() => {
                this.copiedItemId.set(null);
            })();
        }, 600);
    }

    @boundMethod
    handleUse(item: HistoryItem): void {
        if (isBlank(item.cmdstr)) {
            return;
        }
        mobx.action(() => {
            GlobalModel.showSessionView();
            GlobalModel.inputModel.setCurLine(item.cmdstr);
            setTimeout(() => GlobalModel.inputModel.giveFocus(), 50);
        })();
    }

    @boundMethod
    handleClose() {
        GlobalModel.historyViewModel.closeView();
    }

    @boundMethod
    getDefaultWorkspace(sessionId: string, names: Record<string, string>): string {
        if (sessionId == null) {
            return "Limit Workspace";
        }
        return formatSessionName(names, sessionId);
    }

    @boundMethod
    getWorkspaceItems(snames: Record<string, string>, sessionIds: string[]): { label: string; value: string }[] {
        return sessionIds.reduce<{ label: string; value: string }[]>((items, sessionId) => {
            items.push({ label: "#" + snames[sessionId], value: sessionId });
            return items;
        }, []);
    }

    @boundMethod
    getDefaultRemote(remoteId: string, names: Record<string, string>): string {
        if (remoteId == null) {
            return "Limit Remote";
        }
        return formatRemoteName(names, { remoteid: remoteId });
    }

    @boundMethod
    getRemoteItems(rnames: Record<string, string>, remoteIds: string[]): { label: string; value: string }[] {
        return remoteIds.reduce<{ label: string; value: string }[]>(
            (items, remoteId) => {
                items.push({ label: "[" + rnames[remoteId] + "]", value: remoteId });
                return items;
            },
            [{ label: "(all remotes)", value: null }]
        );
    }

    render() {
        let isHidden = GlobalModel.activeMainView.get() != "history";
        if (isHidden) {
            return null;
        }
        let hvm = GlobalModel.historyViewModel;
        let item: HistoryItem = null;
        let items = hvm.items.slice();
        let nowDate = new Date();
        let snames = GlobalModel.getSessionNames();
        let rnames = GlobalModel.getRemoteNames();
        let scrnames = GlobalModel.getScreenNames();
        let hasMore = hvm.hasMore.get();
        let offset = hvm.offset.get();
        let numSelected = hvm.selectedItems.size;
        let activeItemId = hvm.activeItem.get();
        let sessionIds = Object.keys(snames);
        let sessionId: string = null;
        let remoteIds = Object.keys(rnames);
        let remoteId: string = null;

        return (
            <MainView className="history-view" title="History" onClose={this.handleClose}>
                <If condition={!isHidden}>
                    <HistoryKeybindings></HistoryKeybindings>
                </If>
                <div key="search" className="history-search">
                    <div className="main-search field">
                        <TextField
                            placeholder="Exact String Search"
                            onChange={this.changeSearchText}
                            onKeyDown={this.searchKeyDown}
                            decoration={{ startDecoration: <SearchIcon className="icon" /> }}
                        />
                    </div>
                    <div className="advanced-search">
                        <Dropdown
                            className="workspace-dropdown"
                            defaultValue={this.getDefaultWorkspace(hvm.searchSessionId.get(), snames)}
                            options={this.getWorkspaceItems(snames, sessionIds)}
                            onChange={this.clickLimitSession}
                        />
                        <Dropdown
                            className="remote-dropdown"
                            defaultValue={this.getDefaultRemote(hvm.searchRemoteId.get(), rnames)}
                            options={this.getRemoteItems(rnames, remoteIds)}
                            onChange={this.clickLimitRemote}
                        />
                        <div className="fromts">
                            <div className="fromts-text">From:&nbsp;</div>
                            <DatePicker selectedDate={new Date()} onSelectDate={this.handleFromTsChange} />
                        </div>
                        <div
                            className="filter-cmds search-checkbox hoverEffect"
                            title="Filter common commands like 'ls' and 'cd' from the results"
                        >
                            <div className="checkbox-container">
                                <input
                                    onChange={this.toggleFilterCmds}
                                    type="checkbox"
                                    checked={hvm.searchFilterCmds.get()}
                                />
                            </div>
                            <div onClick={this.toggleFilterCmds} className="checkbox-text">
                                Filter Cmds
                            </div>
                        </div>
                        <Button className="secondary reset-button" onClick={this.resetAllFilters}>
                            Reset All
                        </Button>
                    </div>
                </div>
                <div key="control1" className={cn("control-bar", "is-top", { "is-hidden": items.length == 0 })}>
                    <div className="control-checkbox" onClick={this.handleControlCheckbox} title="Toggle Selection">
                        <HistoryCheckbox
                            checked={numSelected > 0 && numSelected == items.length}
                            partialCheck={numSelected > 0}
                        />
                    </div>
                    <div
                        className={cn(
                            "control-button delete-button",
                            { "is-disabled": numSelected == 0 },
                            { "is-active": hvm.deleteActive.get() }
                        )}
                        onClick={this.handleClickDelete}
                    >
                        <span>
                            <TrashIcon className="trash-icon" title="Purge Selected Items" />
                            &nbsp;Delete Items
                        </span>
                    </div>
                    <div className="spacer" />
                    <div className="showing-text">
                        Showing {offset + 1}-{offset + items.length}
                    </div>
                    <div
                        className={cn("showing-btn", { "is-disabled": offset == 0 })}
                        onClick={offset != 0 ? this.handlePrev : null}
                    >
                        <ChevronLeftIcon className="icon" />
                    </div>
                    <div className="btn-spacer" />
                    <div
                        className={cn("showing-btn", { "is-disabled": !hasMore })}
                        onClick={hasMore ? this.handleNext : null}
                    >
                        <ChevronRightIcon className="icon" />
                    </div>
                </div>
                <If condition={items.length == 0}>
                    <div key="no-items" className="no-items">
                        <div>No History Items Found</div>
                    </div>
                </If>
                <div key="hsr" className="history-scroll-region">
                    <div className="history-table" ref={this.tableRef}>
                        <For index="idx" each="item" of={items}>
                            <div
                                key={item.historyid}
                                className={cn("row history-item", {
                                    "is-selected": hvm.selectedItems.get(item.historyid),
                                })}
                            >
                                <div className="cell selectbox" onClick={() => this.handleSelect(item.historyid)}>
                                    <HistoryCheckbox checked={hvm.selectedItems.get(item.historyid)} />
                                </div>
                                <div className="cell cmdstr">
                                    <HistoryCmdStr
                                        cmdstr={item.cmdstr}
                                        onUse={() => this.handleUse(item)}
                                        onCopy={() => this.handleCopy(item)}
                                        isCopied={this.copiedItemId.get() == item.historyid}
                                        fontSize="normal"
                                        limitHeight={true}
                                    />
                                    <div
                                        className="flex-spacer activate-item-spacer"
                                        onClick={() => this.activateItem(item.historyid)}
                                    />
                                </div>
                                <div className="cell workspace">{formatSSName(snames, scrnames, item)}</div>
                                <div className="cell remote">{formatRemoteName(rnames, item.remote)}</div>
                                <div className="cell ts">{getHistoryViewTs(nowDate, item.ts)}</div>
                                <div className="cell downarrow" onClick={() => this.activateItem(item.historyid)}>
                                    <If condition={activeItemId != item.historyid}>
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            width="16"
                                            height="16"
                                            viewBox="0 0 16 16"
                                            fill="none"
                                        >
                                            <path
                                                d="M12.1297 6.62492C12.3999 6.93881 12.3645 7.41237 12.0506 7.68263L8.48447 10.7531C8.20296 10.9955 7.78645 10.9952 7.50519 10.7526L3.94636 7.68213C3.63274 7.41155 3.59785 6.93796 3.86843 6.62434C4.13901 6.31072 4.6126 6.27583 4.92622 6.54641L7.99562 9.19459L11.0719 6.54591C11.3858 6.27565 11.8594 6.31102 12.1297 6.62492Z"
                                                fill="#C3C8C2"
                                            />
                                        </svg>
                                    </If>
                                    <If condition={activeItemId == item.historyid}>
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            width="16"
                                            height="16"
                                            viewBox="0 0 16 16"
                                            fill="none"
                                        >
                                            <path
                                                d="M3.87035 9.37508C3.60009 9.06119 3.63546 8.58763 3.94936 8.31737L7.51553 5.24692C7.79704 5.00455 8.21355 5.00476 8.49481 5.24742L12.0536 8.31787C12.3673 8.58845 12.4022 9.06204 12.1316 9.37566C11.861 9.68928 11.3874 9.72417 11.0738 9.45359L8.00438 6.80541L4.92806 9.45409C4.61416 9.72435 4.14061 9.68898 3.87035 9.37508Z"
                                                fill="#C3C8C2"
                                            />
                                        </svg>
                                    </If>
                                </div>
                            </div>
                            <If condition={activeItemId == item.historyid}>
                                <div className="row active-history-item">
                                    <div className="cell">
                                        <LineContainer
                                            key={activeItemId}
                                            historyId={activeItemId}
                                            width={this.tableWidth.get()}
                                        />
                                    </div>
                                </div>
                            </If>
                        </For>
                    </div>
                </div>
                <div
                    key="control2"
                    className={cn("control-bar", "is-bottom", { "is-hidden": items.length == 0 || !hasMore })}
                >
                    <div className="spacer" />
                    <div className="showing-text">
                        Showing {offset + 1}-{offset + items.length}
                    </div>
                    <div
                        className={cn("showing-btn", { "is-disabled": offset == 0 })}
                        onClick={offset != 0 ? this.handlePrev : null}
                    >
                        <ChevronLeftIcon className="icon" />
                    </div>
                    <div className="btn-spacer" />
                    <div
                        className={cn("showing-btn", { "is-disabled": !hasMore })}
                        onClick={hasMore ? this.handleNext : null}
                    >
                        <ChevronRightIcon className="icon" />
                    </div>
                </div>
            </MainView>
        );
    }
}

class LineContainer extends React.Component<{ historyId: string; width: number }, {}> {
    line: LineType;
    historyItem: HistoryItem;
    visible: OV<boolean> = mobx.observable.box(true);
    overrideCollapsed: OV<boolean> = mobx.observable.box(false);

    constructor(props: any) {
        super(props);
        let hvm = GlobalModel.historyViewModel;
        this.historyItem = hvm.getHistoryItemById(props.historyId);
        if (this.historyItem == null) {
            return;
        }
        this.line = hvm.getLineById(this.historyItem.lineid);
    }

    @boundMethod
    handleHeightChange(lineNum: number, newHeight: number, oldHeight: number): void {
        return;
    }

    @boundMethod
    viewInContext() {
        let screen = GlobalModel.getScreenById(this.historyItem.sessionid, this.historyItem.screenid);
        if (screen == null) {
            return null;
        }
        GlobalModel.historyViewModel.closeView();
        GlobalCommandRunner.lineView(screen.sessionId, screen.screenId, this.line.linenum);
    }

    render() {
        let hvm = GlobalModel.historyViewModel;
        if (this.historyItem == null || this.props.width == 0) {
            return null;
        }
        if (this.line == null) {
            return (
                <div className="line-container no-line">
                    <div>[no line data]</div>
                </div>
            );
        }
        let width = this.props.width;
        width = width - 50;
        if (width < 400) {
            width = 400;
        }
        let session = GlobalModel.getSessionById(this.historyItem.sessionid);
        let screen = GlobalModel.getScreenById(this.historyItem.sessionid, this.historyItem.screenid);
        let ssStr = "";
        let canViewInContext = false;
        if (session != null && screen != null) {
            ssStr = sprintf("#%s[%s]", session.name.get(), screen.name.get());
            canViewInContext = true;
        }
        return (
            <div className="line-container">
                <If condition={canViewInContext}>
                    <div className="line-context">
                        <div title="View in Context" className="vic-btn" onClick={this.viewInContext}>
                            <RightIcon className="icon" /> {ssStr}
                        </div>
                    </div>
                </If>
                <If condition={session == null}>
                    <div className="no-line-context" />
                </If>
                <Line
                    screen={hvm.specialLineContainer}
                    line={this.line}
                    width={width}
                    staticRender={false}
                    visible={this.visible}
                    onHeightChange={this.handleHeightChange}
                    overrideCollapsed={this.overrideCollapsed}
                    topBorder={false}
                    renderMode="normal"
                    noSelect={true}
                />
            </div>
        );
    }
}

export { HistoryView };
