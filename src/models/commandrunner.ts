// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { GlobalModel } from "./global";

class CommandRunner {
    private constructor() {}

    static getInstance(): CommandRunner {
        if (!(window as any).GlobalCommandRunner) {
            (window as any).GlobalCommandRunner = new CommandRunner();
        }
        return (window as any).GlobalCommandRunner;
    }

    loadHistory(show: boolean, htype: string) {
        let kwargs = { nohist: "1" };
        if (!show) {
            kwargs["noshow"] = "1";
        }
        if (htype != null && htype != "screen") {
            kwargs["type"] = htype;
        }
        GlobalModel.submitCommand("history", null, null, kwargs, true);
    }

    resetShellState() {
        GlobalModel.submitCommand("reset", null, null, null, true);
    }

    historyPurgeLines(lines: string[]): Promise<CommandRtnType> {
        let prtn = GlobalModel.submitCommand("history", "purge", lines, { nohist: "1" }, false);
        return prtn;
    }

    switchView(view: string) {
        mobx.action(() => {
            GlobalModel.activeMainView.set(view);
        })();
    }

    switchSession(session: string) {
        mobx.action(() => {
            GlobalModel.activeMainView.set("session");
        })();
        GlobalModel.submitCommand("session", null, [session], { nohist: "1" }, false);
    }

    switchScreen(screen: string, session?: string) {
        mobx.action(() => {
            GlobalModel.activeMainView.set("session");
        })();
        let kwargs = { nohist: "1" };
        if (session != null) {
            kwargs["session"] = session;
        }
        GlobalModel.submitCommand("screen", null, [screen], kwargs, false);
    }

    lineView(sessionId: string, screenId: string, lineNum?: number) {
        let screen = GlobalModel.getScreenById(sessionId, screenId);
        if (screen != null && lineNum != null) {
            screen.setAnchorFields(lineNum, 0, "line:view");
        }
        let lineNumStr = lineNum == null || lineNum == 0 ? "E" : String(lineNum);
        GlobalModel.submitCommand("line", "view", [sessionId, screenId, lineNumStr], { nohist: "1" }, false);
    }

    lineArchive(lineArg: string, archive: boolean): Promise<CommandRtnType> {
        let kwargs = { nohist: "1" };
        let archiveStr = archive ? "1" : "0";
        return GlobalModel.submitCommand("line", "archive", [lineArg, archiveStr], kwargs, false);
    }

    lineDelete(lineArg: string, interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("line", "delete", [lineArg], { nohist: "1" }, interactive);
    }

    lineMinimize(lineId: string, minimize: boolean, interactive: boolean): Promise<CommandRtnType> {
        let minimizeStr = minimize ? "1" : "0";
        return GlobalModel.submitCommand("line", "minimize", [lineId, minimizeStr], { nohist: "1" }, interactive);
    }

    lineRestart(lineArg: string, interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("line", "restart", [lineArg], { nohist: "1" }, interactive);
    }

    lineSet(lineArg: string, opts: { renderer?: string }): Promise<CommandRtnType> {
        let kwargs = { nohist: "1" };
        if ("renderer" in opts) {
            kwargs["renderer"] = opts.renderer ?? "";
        }
        return GlobalModel.submitCommand("line", "set", [lineArg], kwargs, false);
    }

    createNewSession() {
        GlobalModel.submitCommand("session", "open", null, { nohist: "1" }, false);
    }

    createNewScreen() {
        GlobalModel.submitCommand("screen", "open", null, { nohist: "1" }, false);
    }

    closeScreen(screen: string) {
        GlobalModel.submitCommand("screen", "close", [screen], { nohist: "1" }, false);
    }

    // include is lineIds to include, exclude is lineIds to exclude
    // if include is given then it *only* does those ids.  if exclude is given (or not),
    // it does all running commands in the screen except for excluded.
    resizeScreen(screenId: string, rows: number, cols: number, opts?: { include?: string[]; exclude?: string[] }) {
        let kwargs: Record<string, string> = {
            nohist: "1",
            screen: screenId,
            cols: String(cols),
            rows: String(rows),
        };
        if (opts?.include != null && opts?.include.length > 0) {
            kwargs.include = opts.include.join(",");
        }
        if (opts?.exclude != null && opts?.exclude.length > 0) {
            kwargs.exclude = opts.exclude.join(",");
        }
        GlobalModel.submitCommand("screen", "resize", null, kwargs, false);
    }

    screenArchive(screenId: string, shouldArchive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand(
            "screen",
            "archive",
            [screenId, shouldArchive ? "1" : "0"],
            { nohist: "1" },
            false
        );
    }

    screenDelete(screenId: string, interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("screen", "delete", [screenId], { nohist: "1" }, interactive);
    }

    screenWebShare(screenId: string, shouldShare: boolean): Promise<CommandRtnType> {
        let kwargs: Record<string, string> = { nohist: "1" };
        kwargs["screen"] = screenId;
        return GlobalModel.submitCommand("screen", "webshare", [shouldShare ? "1" : "0"], kwargs, false);
    }

    showRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "show", null, { nohist: "1", remote: remoteid }, true);
    }

    showAllRemotes() {
        GlobalModel.submitCommand("remote", "showall", null, { nohist: "1" }, true);
    }

    connectRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "connect", null, { nohist: "1", remote: remoteid }, true);
    }

    disconnectRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "disconnect", null, { nohist: "1", remote: remoteid }, true);
    }

    installRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "install", null, { nohist: "1", remote: remoteid }, true);
    }

    installCancelRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "installcancel", null, { nohist: "1", remote: remoteid }, true);
    }

    createRemote(cname: string, kwargsArg: Record<string, string>, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = Object.assign({}, kwargsArg);
        kwargs["nohist"] = "1";
        return GlobalModel.submitCommand("remote", "new", [cname], kwargs, interactive);
    }

    openCreateRemote(): void {
        GlobalModel.submitCommand("remote", "new", null, { nohist: "1", visual: "1" }, true);
    }

    screenSetRemote(remoteArg: string, nohist: boolean, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = {};
        if (nohist) {
            kwargs["nohist"] = "1";
        }
        return GlobalModel.submitCommand("connect", null, [remoteArg], kwargs, interactive);
    }

    editRemote(remoteid: string, kwargsArg: Record<string, string>): void {
        let kwargs = Object.assign({}, kwargsArg);
        kwargs["nohist"] = "1";
        kwargs["remote"] = remoteid;
        GlobalModel.submitCommand("remote", "set", null, kwargs, true);
    }

    openEditRemote(remoteid: string): void {
        GlobalModel.submitCommand("remote", "set", null, { remote: remoteid, nohist: "1", visual: "1" }, true);
    }

    archiveRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "archive", null, { remote: remoteid, nohist: "1" }, true);
    }

    importSshConfig() {
        GlobalModel.submitCommand("remote", "parse", null, { nohist: "1", visual: "1" }, true);
    }

    screenSelectLine(lineArg: string, focusVal?: string) {
        let kwargs: Record<string, string> = {
            nohist: "1",
            line: lineArg,
        };
        if (focusVal != null) {
            kwargs["focus"] = focusVal;
        }
        GlobalModel.submitCommand("screen", "set", null, kwargs, false);
    }

    screenReorder(screenId: string, index: string) {
        let kwargs: Record<string, string> = {
            nohist: "1",
            screenId: screenId,
            index: index,
        };
        GlobalModel.submitCommand("screen", "reorder", null, kwargs, false);
    }

    setTermUsedRows(termContext: RendererContext, height: number) {
        let kwargs: Record<string, string> = {};
        kwargs["screen"] = termContext.screenId;
        kwargs["hohist"] = "1";
        let posargs = [String(termContext.lineNum), String(height)];
        GlobalModel.submitCommand("line", "setheight", posargs, kwargs, false);
    }

    screenSetAnchor(sessionId: string, screenId: string, anchorVal: string): void {
        let kwargs = {
            nohist: "1",
            anchor: anchorVal,
            session: sessionId,
            screen: screenId,
        };
        GlobalModel.submitCommand("screen", "set", null, kwargs, false);
    }

    screenSetFocus(focusVal: string): void {
        GlobalModel.submitCommand("screen", "set", null, { focus: focusVal, nohist: "1" }, false);
    }

    screenSetSettings(
        screenId: string,
        settings: { tabcolor?: string; tabicon?: string; name?: string; sharename?: string },
        interactive: boolean
    ): Promise<CommandRtnType> {
        let kwargs: { [key: string]: any } = Object.assign({}, settings);
        kwargs["nohist"] = "1";
        kwargs["screen"] = screenId;
        return GlobalModel.submitCommand("screen", "set", null, kwargs, interactive);
    }

    sessionArchive(sessionId: string, shouldArchive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand(
            "session",
            "archive",
            [sessionId, shouldArchive ? "1" : "0"],
            { nohist: "1" },
            false
        );
    }

    sessionDelete(sessionId: string): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("session", "delete", [sessionId], { nohist: "1" }, false);
    }

    sessionSetSettings(sessionId: string, settings: { name?: string }, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = Object.assign({}, settings);
        kwargs["nohist"] = "1";
        kwargs["session"] = sessionId;
        return GlobalModel.submitCommand("session", "set", null, kwargs, interactive);
    }

    lineStar(lineId: string, starVal: number) {
        GlobalModel.submitCommand("line", "star", [lineId, String(starVal)], { nohist: "1" }, true);
    }

    lineBookmark(lineId: string) {
        GlobalModel.submitCommand("line", "bookmark", [lineId], { nohist: "1" }, true);
    }

    linePin(lineId: string, val: boolean) {
        GlobalModel.submitCommand("line", "pin", [lineId, val ? "1" : "0"], { nohist: "1" }, true);
    }

    bookmarksView() {
        GlobalModel.submitCommand("bookmarks", "show", null, { nohist: "1" }, true);
    }

    connectionsView() {
        GlobalModel.connectionViewModel.showConnectionsView();
    }

    clientSettingsView() {
        GlobalModel.clientSettingsViewModel.showClientSettingsView();
    }

    syncShellState() {
        GlobalModel.submitCommand("sync", null, null, { nohist: "1" }, false);
    }

    historyView(params: HistorySearchParams) {
        let kwargs = { nohist: "1" };
        kwargs["offset"] = String(params.offset);
        kwargs["rawoffset"] = String(params.rawOffset);
        if (params.searchText != null) {
            kwargs["text"] = params.searchText;
        }
        if (params.searchSessionId != null) {
            kwargs["searchsession"] = params.searchSessionId;
        }
        if (params.searchRemoteId != null) {
            kwargs["searchremote"] = params.searchRemoteId;
        }
        if (params.fromTs != null) {
            kwargs["fromts"] = String(params.fromTs);
        }
        if (params.noMeta) {
            kwargs["meta"] = "0";
        }
        if (params.filterCmds) {
            kwargs["filter"] = "1";
        }
        GlobalModel.submitCommand("history", "viewall", null, kwargs, true);
    }

    telemetryOff(interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("telemetry", "off", null, { nohist: "1" }, interactive);
    }

    telemetryOn(interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("telemetry", "on", null, { nohist: "1" }, interactive);
    }

    releaseCheckAutoOff(interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("releasecheck", "autooff", null, { nohist: "1" }, interactive);
    }

    releaseCheckAutoOn(interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("releasecheck", "autoon", null, { nohist: "1" }, interactive);
    }

    setTermFontSize(fsize: number, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = {
            nohist: "1",
            termfontsize: String(fsize),
        };
        return GlobalModel.submitCommand("client", "set", null, kwargs, interactive);
    }

    setTermFontFamily(fontFamily: string, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = {
            nohist: "1",
            termfontfamily: fontFamily,
        };
        return GlobalModel.submitCommand("client", "set", null, kwargs, interactive);
    }

    setTheme(theme: string, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = {
            nohist: "1",
            theme: theme,
        };
        return GlobalModel.submitCommand("client", "set", null, kwargs, interactive);
    }

    setTerminalTheme(theme: string, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = {
            nohist: "1",
            terminaltheme: theme,
        };
        return GlobalModel.submitCommand("client", "set", null, kwargs, interactive);
    }

    setClientOpenAISettings(opts: {
        model?: string;
        apitoken?: string;
        maxtokens?: string;
        baseurl?: string;
    }): Promise<CommandRtnType> {
        let kwargs = {
            nohist: "1",
        };
        if (opts.model != null) {
            kwargs["openaimodel"] = opts.model;
        }
        if (opts.apitoken != null) {
            kwargs["openaiapitoken"] = opts.apitoken;
        }
        if (opts.maxtokens != null) {
            kwargs["openaimaxtokens"] = opts.maxtokens;
        }
        if (opts.baseurl != null) {
            kwargs["openaibaseurl"] = opts.baseurl;
        }
        return GlobalModel.submitCommand("client", "set", null, kwargs, false);
    }

    clientAcceptTos(): void {
        GlobalModel.submitCommand("client", "accepttos", null, { nohist: "1" }, true);
    }

    clientSetConfirmFlag(flag: string, value: boolean): Promise<CommandRtnType> {
        let kwargs = { nohist: "1" };
        let valueStr = value ? "1" : "0";
        return GlobalModel.submitCommand("client", "setconfirmflag", [flag, valueStr], kwargs, false);
    }

    clientSetMainSidebar(width: number, collapsed: boolean): Promise<CommandRtnType> {
        let kwargs = { nohist: "1", width: `${width}`, collapsed: collapsed ? "1" : "0" };
        return GlobalModel.submitCommand("client", "setmainsidebar", null, kwargs, false);
    }

    clientSetRightSidebar(width: number, collapsed: boolean): Promise<CommandRtnType> {
        let kwargs = { nohist: "1", width: `${width}`, collapsed: collapsed ? "1" : "0" };
        return GlobalModel.submitCommand("client", "setrightsidebar", null, kwargs, false);
    }

    editBookmark(bookmarkId: string, desc: string, cmdstr: string) {
        let kwargs = {
            nohist: "1",
            desc: desc,
            cmdstr: cmdstr,
        };
        GlobalModel.submitCommand("bookmark", "set", [bookmarkId], kwargs, true);
    }

    deleteBookmark(bookmarkId: string): void {
        GlobalModel.submitCommand("bookmark", "delete", [bookmarkId], { nohist: "1" }, true);
    }

    openSharedSession(): void {
        GlobalModel.submitCommand("session", "openshared", null, { nohist: "1" }, true);
    }

    setLineState(
        screenId: string,
        lineId: string,
        state: LineStateType,
        interactive: boolean
    ): Promise<CommandRtnType> {
        let stateStr = JSON.stringify(state);
        return GlobalModel.submitCommand(
            "line",
            "set",
            [lineId],
            { screen: screenId, nohist: "1", state: stateStr },
            interactive
        );
    }

    screenSidebarAddLine(lineId: string) {
        GlobalModel.submitCommand("sidebar", "add", null, { nohist: "1", line: lineId }, false);
    }

    screenSidebarRemove() {
        GlobalModel.submitCommand("sidebar", "remove", null, { nohist: "1" }, false);
    }

    screenSidebarClose(): void {
        GlobalModel.submitCommand("sidebar", "close", null, { nohist: "1" }, false);
    }

    screenSidebarOpen(width?: string): void {
        let kwargs: Record<string, string> = { nohist: "1" };
        if (width != null) {
            kwargs.width = width;
        }
        GlobalModel.submitCommand("sidebar", "open", null, kwargs, false);
    }

    setGlobalShortcut(shortcut: string): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("client", "setglobalshortcut", [shortcut], { nohist: "1" }, false);
    }
}

export { CommandRunner };
