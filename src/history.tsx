import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import cn from "classnames";
import {GlobalModel, GlobalCommandRunner, Cmd} from "./model";
import {HistoryItem, RemotePtrType, LineType, CmdDataType} from "./types";
import dayjs from "dayjs";
import localizedFormat from 'dayjs/plugin/localizedFormat';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import {Line} from "./linecomps";

dayjs.extend(customParseFormat)
dayjs.extend(localizedFormat)

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K,V> = mobx.ObservableMap<K,V>;
type CV<V> = mobx.IComputedValue<V>;

function isBlank(s : string) {
    return (s == null || s == "");
}

function getHistoryViewTs(nowDate : Date, ts : number) : string {
    let itemDate = new Date(ts);
    if (nowDate.getFullYear() != itemDate.getFullYear()) {
        return dayjs(itemDate).format("M/D/YY");
    }
    else if (nowDate.getMonth() != itemDate.getMonth() || nowDate.getDate() != itemDate.getDate()) {
        return dayjs(itemDate).format("MMM D");
    }
    else {
        return dayjs(itemDate).format("h:mm A");
    }
}

function formatRemoteName(rnames : Record<string, string>, rptr : RemotePtrType) : string {
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

function formatSSName(snames : Record<string, string>, scrnames : Record<string, string>, item : HistoryItem) : string {
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

function formatSessionName(snames : Record<string, string>, sessionId : string) : string {
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
class HistoryView extends React.Component<{}, {}> {
    tableRef : React.RefObject<any> = React.createRef();
    tableWidth : OV<number> = mobx.observable.box(0, {name: "tableWidth"});
    tableRszObs : ResizeObserver;
    sessionDropdownActive : OV<boolean> = mobx.observable.box(false, {name: "sessionDropdownActive"});
    remoteDropdownActive : OV<boolean> = mobx.observable.box(false, {name: "remoteDropdownActive"});
    
    @boundMethod
    clickCloseHandler() : void {
        GlobalModel.historyViewModel.closeView();
    }

    @boundMethod
    handleNext() {
        GlobalModel.historyViewModel.goNext();
    }

    @boundMethod
    handlePrev() {
        GlobalModel.historyViewModel.goPrev();
    }

    @boundMethod
    changeSearchText(e : any) {
        mobx.action(() => {
            GlobalModel.historyViewModel.searchText.set(e.target.value);
        })();
    }

    @boundMethod
    searchKeyDown(e : any) {
        if (e.code == "Enter") {
            e.preventDefault();
            GlobalModel.historyViewModel.submitSearch();
            return;
        }
    }

    @boundMethod
    handleSelect(historyId : string) {
        let hvm = GlobalModel.historyViewModel;
        mobx.action(() => {
            if (hvm.selectedItems.get(historyId)) {
                hvm.selectedItems.delete(historyId);
            }
            else {
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
                return;
            }
            else {
                for (let i=0; i<hvm.items.length; i++) {
                    hvm.selectedItems.set(hvm.items[i].historyid, true);
                }
            }
        })();
    }

    @boundMethod
    handleClickDelete() {
        GlobalModel.historyViewModel.doSelectedDelete();
    }

    @boundMethod
    activateItem(historyId : string) {
        if (GlobalModel.historyViewModel.activeItem.get() == historyId) {
            GlobalModel.historyViewModel.setActiveItem(null);
        }
        else {
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

    searchFromTsInputValue() : string {
        let hvm = GlobalModel.historyViewModel;
        let fromDate = hvm.searchFromDate.get();
        if (fromDate == null) {
            return dayjs().format("YYYY-MM-DD");
        }
        return fromDate;
    }

    @boundMethod
    handleFromTsChange(e : any) : void {
        let hvm = GlobalModel.historyViewModel;
        let newDate = e.target.value;
        let today = dayjs().format("YYYY-MM-DD");
        if (newDate == "" || newDate == today) {
            hvm.setFromDate(null);
            return;
        }
        hvm.setFromDate(e.target.value);
        return;
    }

    @boundMethod
    toggleSessionDropdown() : void {
        mobx.action(() => {
            this.sessionDropdownActive.set(!this.sessionDropdownActive.get());
            if (this.sessionDropdownActive.get()) {
                this.remoteDropdownActive.set(false);
            }
        })();
    }

    @boundMethod
    clickLimitSession(sessionId : string) : void {
        let hvm = GlobalModel.historyViewModel;
        mobx.action(() => {
            this.sessionDropdownActive.set(false);
            hvm.setSearchSessionId(sessionId);
        })();
    }

    @boundMethod
    toggleRemoteDropdown() : void {
        mobx.action(() => {
            this.remoteDropdownActive.set(!this.remoteDropdownActive.get());
            if (this.remoteDropdownActive.get()) {
                this.sessionDropdownActive.set(false);
            }
        })();
    }

    @boundMethod
    clickLimitRemote(remoteId : string) : void {
        let hvm = GlobalModel.historyViewModel;
        mobx.action(() => {
            this.remoteDropdownActive.set(false);
            hvm.setSearchRemoteId(remoteId);
        })();
    }

    @boundMethod
    toggleShowMeta() : void {
        let hvm = GlobalModel.historyViewModel;
        mobx.action(() => {
            hvm.setSearchShowMeta(!hvm.searchShowMeta.get());
        })();
    }

    @boundMethod
    toggleFilterCmds() : void {
        let hvm = GlobalModel.historyViewModel;
        mobx.action(() => {
            hvm.setSearchFilterCmds(!hvm.searchFilterCmds.get());
        })();
    }

    @boundMethod
    resetAllFilters() : void {
        let hvm = GlobalModel.historyViewModel;
        hvm.resetAllFilters();
    }
    
    render() {
        let isHidden = (GlobalModel.activeMainView.get() != "history");
        if (isHidden) {
            return null;
        }
        let hvm = GlobalModel.historyViewModel;
        let idx : number = 0;
        let item : HistoryItem = null;
        let items = hvm.items.slice();
        let nowDate = new Date();
        let snames = GlobalModel.getSessionNames();
        let rnames = GlobalModel.getRemoteNames();
        let scrnames = GlobalModel.getScreenNames();
        let hasMore = hvm.hasMore.get();
        let offset = hvm.offset.get();
        let numSelected = hvm.selectedItems.size;
        let controlCheckboxIcon = "fa-sharp fa-regular fa-square";
        if (numSelected > 0) {
            controlCheckboxIcon = "fa-sharp fa-regular fa-square-minus";
        }
        if (numSelected > 0 && numSelected == items.length) {
            controlCheckboxIcon = "fa-sharp fa-regular fa-square-check";
        }
        let activeItemId = hvm.activeItem.get();
        let activeItem = hvm.getHistoryItemById(activeItemId);
        let activeLine : LineType = null;
        if (activeItem != null) {
            activeLine = hvm.getLineById(activeItem.lineid);
        }
        let sessionIds = Object.keys(snames);
        let sessionId : string = null;
        let remoteIds = Object.keys(rnames);
        let remoteId : string = null;
        return (
            <div className={cn("history-view", "alt-view", {"is-hidden": isHidden})}>
                <div className="close-button" onClick={this.clickCloseHandler}><i className="fa-sharp fa-solid fa-xmark"></i></div>
                <div className="header">
                    <div className="history-title">
                        HISTORY
                    </div>
                    <div className="history-search">
                        <div className="main-search field">
                            <p className="control has-icons-left">
                                <input className="input" type="text" placeholder="Exact String Search" value={hvm.searchText.get()} onChange={this.changeSearchText} onKeyDown={this.searchKeyDown}/>
                                <span className="icon is-small is-left">
                                    <i className="fa-sharp fa-solid fa-search"/>
                                </span>
                            </p>
                        </div>
                        <div className="advanced-search">
                            <div className={cn("dropdown", "session-dropdown", {"is-active": this.sessionDropdownActive.get()})}>
                                <div className="dropdown-trigger">
                                    <button onClick={this.toggleSessionDropdown} className="button is-small is-dark">
                                        <span>{hvm.searchSessionId.get() == null ? "Limit Session" : formatSessionName(snames, hvm.searchSessionId.get())}</span>
                                        <span className="icon is-small">
                                            <i className="fa-sharp fa-regular fa-angle-down" aria-hidden="true"></i>
                                        </span>
                                    </button>
                                </div>
                                <div className="dropdown-menu" role="menu">
                                    <div className="dropdown-content has-background-black-ter">
                                        <div onClick={() => this.clickLimitSession(null) } key="all" className="dropdown-item">(all sessions)</div>
                                        <For each="sessionId" of={sessionIds}>
                                            <div onClick={() => this.clickLimitSession(sessionId) } key={sessionId} className="dropdown-item">#{snames[sessionId]}</div>
                                        </For>
                                    </div>
                                </div>
                            </div>
                            <div className={cn("dropdown", "remote-dropdown", {"is-active": this.remoteDropdownActive.get()})}>
                                <div className="dropdown-trigger">
                                    <button onClick={this.toggleRemoteDropdown} className="button is-small is-dark">
                                        <span>{hvm.searchRemoteId.get() == null ? "Limit Remote" : formatRemoteName(rnames, {remoteid: hvm.searchRemoteId.get()})}</span>
                                        <span className="icon is-small">
                                            <i className="fa-sharp fa-regular fa-angle-down" aria-hidden="true"></i>
                                        </span>
                                    </button>
                                </div>
                                <div className="dropdown-menu" role="menu">
                                    <div className="dropdown-content has-background-black-ter">
                                        <div onClick={() => this.clickLimitRemote(null) } key="all" className="dropdown-item">(all remotes)</div>
                                        <For each="remoteId" of={remoteIds}>
                                            <div onClick={() => this.clickLimitRemote(remoteId) } key={remoteId} className="dropdown-item">[{rnames[remoteId]}]</div>
                                        </For>
                                    </div>
                                </div>
                            </div>
                            <div className="allow-meta search-checkbox">
                                <div className="checkbox-container"><input onChange={this.toggleShowMeta} type="checkbox" checked={hvm.searchShowMeta.get()}/></div>
                                <div onClick={this.toggleShowMeta} className="checkbox-text">Show MetaCmds</div>
                            </div>
                            <div className="fromts">
                                <div onClick={this.toggleShowMeta} className="fromts-text">From:&nbsp;</div>
                                <div>
                                    <input type="date" onChange={this.handleFromTsChange} value={this.searchFromTsInputValue()} className="input is-small"/>
                                </div>
                            </div>
                            <div className="filter-cmds search-checkbox" title="Filter common commands like 'ls' and 'cd' from the results">
                                <div className="checkbox-container"><input onChange={this.toggleFilterCmds} type="checkbox" checked={hvm.searchFilterCmds.get()}/></div>
                                <div onClick={this.toggleFilterCmds} className="checkbox-text">Filter Cmds</div>
                            </div>
                            <div onClick={this.resetAllFilters} className="reset-button">
                                Reset All
                            </div>
                        </div>
                    </div>
                </div>
                <div className={cn("control-bar", "is-top", {"is-hidden": (items.length == 0)})}>
                    <div className="control-checkbox" onClick={this.handleControlCheckbox}>
                        <i className={controlCheckboxIcon} title="Toggle Selection"/>
                    </div>
                    <div className={cn("control-button delete-button", {"is-disabled": (numSelected == 0)}, {"is-active": hvm.deleteActive.get()})} onClick={this.handleClickDelete}>
                        <i className="fa-sharp fa-solid fa-trash" title="Purge Selected Items"/> <span>Delete Items</span>
                    </div>
                    <div className="spacer"/>
                    <div className="showing-text">Showing {offset+1}-{offset+items.length}</div>
                    <div className={cn("showing-btn", {"is-disabled": (offset == 0)})} onClick={(offset != 0 ? this.handlePrev : null)}><i className="fa-sharp fa-solid fa-chevron-left"/></div>
                    <div className="btn-spacer"/>
                    <div className={cn("showing-btn", {"is-disabled": !hasMore})} onClick={hasMore ? this.handleNext : null}><i className="fa-sharp fa-solid fa-chevron-right"/></div>
                </div>
                <table className="history-table" cellSpacing="0" cellPadding="0" border={0} ref={this.tableRef}>
                    <tbody>
                        <For index="idx" each="item" of={items}>
                            <tr key={item.historyid} className={cn("history-item", {"is-selected": hvm.selectedItems.get(item.historyid)})}>
                                <td className="selectbox" onClick={() => this.handleSelect(item.historyid)}>
                                    <If condition={hvm.selectedItems.get(item.historyid)}>
                                        <i className="fa-sharp fa-regular fa-square-check"></i>
                                    </If>
                                    <If condition={!hvm.selectedItems.get(item.historyid)}>
                                        <i className="fa-sharp fa-regular fa-square"></i>
                                    </If>
                                </td>
                                <td className="bookmark" style={{display: "none"}}>
                                    <i className="fa-sharp fa-regular fa-bookmark"/>
                                </td>
                                <td className="ts">
                                    {getHistoryViewTs(nowDate, item.ts)}
                                </td>
                                <td className="session">
                                    {formatSSName(snames, scrnames, item)}
                                </td>
                                <td className="remote">
                                    {formatRemoteName(rnames, item.remote)}
                                </td>
                                <td className="cmdstr" onClick={() => this.activateItem(item.historyid)}>
                                    <div className="cmdstr-content">{item.cmdstr}</div>
                                </td>
                            </tr>
                            <If condition={activeItemId == item.historyid}>
                                <tr className="active-history-item">
                                    <td colSpan={6}>
                                        <LineContainer key={activeItemId} historyId={activeItemId} width={this.tableWidth.get()}/>
                                    </td>
                                </tr>
                            </If>
                        </For>
                    </tbody>
                </table>
                <div className={cn("control-bar", {"is-hidden": (items.length == 0 || !hasMore)})}>
                    <div className="spacer"/>
                    <div className="showing-text">Showing {offset+1}-{offset+items.length}</div>
                    <div className={cn("showing-btn", {"is-disabled": (offset == 0)})} onClick={(offset != 0 ? this.handlePrev : null)}><i className="fa-sharp fa-solid fa-chevron-left"/></div>
                    <div className="btn-spacer"/>
                    <div className={cn("showing-btn", {"is-disabled": !hasMore})} onClick={hasMore ? this.handleNext : null}><i className="fa-sharp fa-solid fa-chevron-right"/></div>
                </div>
                <If condition={items.length == 0}>
                    <div className="no-items">
                        <div>No History Items Found</div>
                    </div>
                </If>
                <div className="alt-help">
                    <div className="help-entry">
                        [Esc] to Close<br/>
                    </div>
                </div>
            </div>
        );
    }
}

class LineContainer extends React.Component<{historyId : string, width : number}, {}> {
    line : LineType;
    cmd : Cmd;
    historyItem : HistoryItem;
    visible : OV<boolean> = mobx.observable.box(true);
    overrideCollapsed : OV<boolean> = mobx.observable.box(false);
    
    constructor(props : any) {
        super(props);
        let hvm = GlobalModel.historyViewModel;
        this.historyItem = hvm.getHistoryItemById(props.historyId);
        if (this.historyItem == null) {
            return;
        }
        this.line = hvm.getLineById(this.historyItem.lineid);
        this.cmd = hvm.getCmdById(this.historyItem.cmdid);
    }

    @boundMethod
    handleHeightChange(lineNum : number, newHeight : number, oldHeight : number) : void {
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
            return <div className="line-container no-line"><div>[no line data]</div></div>;
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
                        <div title="View in Context" className="vic-btn" onClick={this.viewInContext}><i className="fa-sharp fa-solid fa-right"/> {ssStr}</div>
                    </div>
                </If>
                <If condition={session == null}>
                    <div className="no-line-context"/>
                </If>
                <Line sw={hvm.specialLineContainer} line={this.line} width={width} staticRender={false} visible={this.visible} onHeightChange={this.handleHeightChange} overrideCollapsed={this.overrideCollapsed} topBorder={false} renderMode="normal"/>
            </div>
        );
    }
}


export {HistoryView};
