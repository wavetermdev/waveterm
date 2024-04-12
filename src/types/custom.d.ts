import { override } from "mobx";

declare module "*.svg" {
    import * as React from "react";
    export const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement> & { title?: string }>;
    const src: string;
    export default src;
}

declare global {
    type ShareModeType = "local" | "web";
    type FocusTypeStrs = "input" | "cmd";
    type HistoryTypeStrs = "global" | "session" | "screen";
    type RemoteStatusTypeStrs = "connected" | "connecting" | "disconnected" | "error";
    type LineContainerStrs = "main" | "sidebar" | "history";
    type AppUpdateStatusType = "unavailable" | "ready";
    type NativeThemeSource = "system" | "light" | "dark";
    type InputAuxViewType = null | "history" | "info" | "aichat" | "suggestions";

    type OV<V> = mobx.IObservableValue<V>;
    type OArr<V> = mobx.IObservableArray<V>;
    type OMap<K, V> = mobx.ObservableMap<K, V>;
    type CV<V> = mobx.IComputedValue<V>;

    type SessionDataType = {
        sessionid: string;
        name: string;
        notifynum: number;
        activescreenid: string;
        sessionidx: number;
        sharemode: ShareModeType;
        archived?: boolean;
        remotes: RemoteInstanceType[];

        // for updates
        remove?: boolean;
    };

    type LineStateType = { [k: string]: any };

    type LineType = {
        screenid: string;
        userid: string;
        lineid: string;
        ts: number;
        linenum: number;
        linenumtemp: boolean;
        linelocal: boolean;
        linetype: string;
        linestate: LineStateType;
        text: string;
        renderer: string;
        contentheight?: number;
        star?: number;
        archived?: boolean;
        pinned?: boolean;
        ephemeral?: boolean;
        remove?: boolean;
    };

    type ScreenOptsType = {
        tabcolor?: string;
        tabicon?: string;
        pterm?: string;
    };

    type WebShareOpts = {
        sharename: string;
        viewkey: string;
    };

    type ScreenViewOptsType = {
        sidebar: ScreenSidebarOptsType;
    };

    type ScreenSidebarOptsType = {
        open: boolean;
        width: string;
        sidebarlineid: string;
    };

    type ScreenDataType = {
        sessionid: string;
        screenid: string;
        screenidx: number;
        name: string;
        sharemode: ShareModeType;
        webshareopts?: WebShareOpts;
        archived?: boolean;
        screenopts: ScreenOptsType;
        screenviewopts: ScreenViewOptsType;
        curremote: RemotePtrType;
        nextlinenum: number;
        selectedline: number;
        focustype: FocusTypeStrs;
        anchor: { anchorline: number; anchoroffset: number };

        // for updates
        remove?: boolean;
    };

    type RemoteOptsType = {
        color: string;
    };

    type RemoteType = {
        remotetype: string;
        remoteid: string;
        remotealias: string;
        remotecanonicalname: string;
        remotevars: Record<string, string>;
        status: RemoteStatusTypeStrs;
        connecttimeout: number;
        countdownactive: boolean;
        errorstr: string;
        installstatus: string;
        installerrorstr: string;
        connectmode: string;
        autoinstall: boolean;
        remoteidx: number;
        sshconfigsrc: string;
        archived: boolean;
        uname: string;
        mshellversion: string;
        needsmshellupgrade: boolean;
        noinitpk: boolean;
        authtype: string;
        waitingforpassword: boolean;
        remoteopts?: RemoteOptsType;
        local: boolean;
        issudo: boolean;
        remove?: boolean;
        shellpref: string;
        defaultshelltype: string;
    };

    type RemoteStateType = {
        cwd: string;
        env0: string; // in base64 "env -0" form
    };

    type RemoteInstanceType = {
        riid: string;
        name: string;
        sessionid: string;
        screenid: string;
        remoteownerid: string;
        remoteid: string;
        festate: Record<string, string>;
        shelltype: string;

        remove?: boolean;
    };

    type RemotePtrType = {
        remoteid: string;
        ownerid?: string;
        name?: string;
    };

    type HistoryItem = {
        historyid: string;
        ts: number;
        userid: string;
        sessionid: string;
        screenid: string;
        lineid: string;
        haderror: boolean;
        cmdstr: string;
        remove: boolean;
        remote: RemotePtrType;
        ismetacmd: boolean;
        historynum: string;
        linenum: number;
    };

    type CmdRemoteStateType = {
        remoteid: string;
        remotename: string;
        cwd: string;
    };

    type UIContextType = {
        sessionid: string;
        screenid: string;
        remote: RemotePtrType;
        winsize: TermWinSize;
        linenum: number;
        build: string;
    };

    type EphemeralCmdOptsType = {
        overridecwd?: string;
        timeoutms?: number;
        expectsresponse: boolean;
        env: { [k: string]: string };
    };

    type FeCmdPacketType = {
        type: string;
        metacmd: string;
        metasubcmd?: string;
        args: string[];
        kwargs: Record<string, string>;
        rawstr?: string;
        uicontext: UIContextType;
        interactive: boolean;
        ephemeralopts?: EphemeralCmdOptsType;
    };

    type FeInputPacketType = {
        type: string;
        ck: string;
        remote: RemotePtrType;
        inputdata64?: string;
        signame?: string;
        winsize?: TermWinSize;
    };

    type RemoteInputPacketType = {
        type: string;
        remoteid: string;
        inputdata64: string;
    };

    type WatchScreenPacketType = {
        type: string;
        sessionid: string;
        screenid: string;
        connect: boolean;
        authkey: string;
    };

    type CmdInputTextPacketType = {
        type: string;
        seqnum: number;
        screenid: string;
        text: StrWithPos;
    };

    type TermWinSize = {
        rows: number;
        cols: number;
    };

    type TermOptsType = {
        rows: number;
        cols: number;
        flexrows?: boolean;
        maxptysize?: number;
    };

    type CmdDataType = {
        screenid: string;
        lineid: string;
        remote: RemotePtrType;
        cmdstr: string;
        rawcmdstr: string;
        festate: Record<string, string>;
        termopts: TermOptsType;
        origtermopts: TermOptsType;
        status: string;
        cmdpid: number;
        remotepid: number;
        restartts: number;
        donets: number;
        exitcode: number;
        durationms: number;
        runout: any[];
        rtnstate: boolean;
        remove?: boolean;
        restarted?: boolean;
    };

    type LineUpdateType = {
        line: LineType;
        cmd: CmdDataType;
    };

    type PtyDataUpdateType = {
        screenid: string;
        lineid: string;
        remoteid: string;
        ptypos: number;
        ptydata64: string;
        ptydatalen: number;
    };

    type ScreenLinesType = {
        screenid: string;
        lines: LineType[];
        cmds: CmdDataType[];
    };

    type OpenAIPacketOutputType = {
        model: string;
        created: number;
        finish_reason: string;
        message: string;
        error?: string;
    };

    type OpenAICmdInfoChatMessageType = {
        isassistantresponse?: boolean;
        assistantresponse?: OpenAIPacketOutputType;
        userquery?: string;
    };

    type DropdownItem = {
        label: string;
        value: string;
    };

    /**
     * Levels for the screen status indicator
     */
    enum StatusIndicatorLevel {
        None = 0,
        Output = 1,
        Success = 2,
        Error = 3,
    }

    type ScreenStatusIndicatorUpdateType = {
        screenid: string;
        status: StatusIndicatorLevel;
    };

    type ScreenNumRunningCommandsUpdateType = {
        screenid: string;
        num: number;
    };

    type ConnectUpdateType = {
        sessions: SessionDataType[];
        screens: ScreenDataType[];
        remotes: RemoteType[];
        screenstatusindicators: ScreenStatusIndicatorUpdateType[];
        screennumrunningcommands: ScreenNumRunningCommandsUpdateType[];
        activesessionid: string;
    };

    type BookmarksUpdateType = {
        bookmarks: BookmarkType[];
        selectedbookmark: string;
    };

    type MainViewUpdateType = {
        mainview: string;
        historyview?: HistoryViewDataType;
        bookmarksview?: BookmarksUpdateType;
    };

    type ModelUpdateType = {
        items?: ModelUpdateItemType[];
    };

    type ModelUpdateItemType = {
        interactive: boolean;
        session?: SessionDataType;
        activesessionid?: string;
        screen?: ScreenDataType;
        screenlines?: ScreenLinesType;
        line?: LineUpdateType;
        cmd?: CmdDataType;
        info?: InfoType;
        cmdline?: StrWithPos;
        remote?: RemoteType;
        history?: HistoryInfoType;
        connect?: ConnectUpdateType;
        mainview?: MainViewUpdateType;
        bookmarks?: BookmarksUpdateType;
        clientdata?: ClientDataType;
        remoteview?: RemoteViewType;
        openaicmdinfochat?: OpenAICmdInfoChatMessageType[];
        alertmessage?: AlertMessageType;
        screenstatusindicator?: ScreenStatusIndicatorUpdateType;
        screennumrunningcommands?: ScreenNumRunningCommandsUpdateType;
        userinputrequest?: UserInputRequest;
        screentombstone?: any;
        sessiontombstone?: any;
    };

    type HistoryViewDataType = {
        items: HistoryItem[];
        offset: number;
        rawoffset: number;
        nextrawoffset: number;
        hasmore: boolean;
        lines: LineType[];
        cmds: CmdDataType[];
    };

    type BookmarkType = {
        bookmarkid: string;
        createdts: number;
        cmdstr: string;
        alias: string;
        tags: string[];
        description: string;
        cmds: string[];
        orderidx: number;
        remove?: boolean;
    };

    type HistoryInfoType = {
        historytype: HistoryTypeStrs;
        sessionid: string;
        screenid: string;
        items: HistoryItem[];
        show: boolean;
    };

    type CmdLineUpdateType = {
        cmdline: string;
        cursorpos: number;
    };

    type RemoteEditType = {
        remoteedit: boolean;
        remoteid?: string;
        errorstr?: string;
        infostr?: string;
        keystr?: string;
        haspassword?: boolean;
        // @TODO: this is a hack to determine which create modal to show
        old?: boolean;
    };

    type InfoType = {
        infotitle?: string;
        infomsg?: string;
        infoelement?: React.ReactNode;
        infomsghtml?: boolean;
        websharelink?: boolean;
        infoerror?: string;
        infoerrorcode?: string;
        infolines?: string[];
        infocomps?: string[];
        infocompsmore?: boolean;
        timeoutms?: number;
    };

    type RemoteViewType = {
        ptyremoteid?: string;
        remoteedit?: RemoteEditType;
        remoteshowall?: boolean;
    };

    type HistoryQueryOpts = {
        queryType: "global" | "session" | "screen";
        limitRemote: boolean;
        limitRemoteInstance: boolean;
        limitUser: boolean;
        queryStr: string;
        maxItems: number;
        includeMeta: boolean;
        fromTs: number;
    };

    type ContextMenuOpts = {
        showCut?: boolean;
    };

    type ModelUpdatePacket = {
        type: "model";
        data: ModelUpdateItemType[];
    };

    type PtyDataUpdatePacket = {
        type: "pty";
        data: PtyDataUpdateType;
    };

    type UpdatePacket = ModelUpdatePacket | PtyDataUpdatePacket;

    type RendererContext = {
        screenId: string;
        lineId: string;
        lineNum: number;
    };

    type RemoteTermContext = { remoteId: string };

    type TermContextUnion = RendererContext | RemoteTermContext;

    type RendererOpts = {
        maxSize: WindowSize;
        idealSize: WindowSize;
        termOpts: TermOptsType;
        termFontSize: number;
        termFontFamily: string;
    };

    type RendererOptsUpdate = {
        maxSize?: WindowSize;
        idealSize?: WindowSize;
        termOpts?: TermOptsType;
        termFontSize?: number;
    };

    type RendererPluginType = {
        name: string;
        rendererType: "simple" | "full";
        heightType: "rows" | "pixels";
        dataType: "json" | "blob" | "model";
        collapseType: "hide" | "remove";
        hidePrompt?: boolean;
        globalCss?: string;
        mimeTypes?: string[];
        modelCtor?: () => RendererModel;
        simpleComponent?: SimpleBlobRendererComponent;
        fullComponent?: FullRendererComponent;
        readme?: string;
        screenshots?: any[];
        vendor?: string;
        summary?: string;
        title?: string;
        iconComp?: React.Component<{}, {}>;
    };

    type RendererModelContainerApi = {
        onFocusChanged: (focus: boolean) => void;
        saveHeight: (height: number) => void;
        dataHandler: (data: string, model: RendererModel) => void;
    };

    type RendererModelInitializeParams = {
        context: RendererContext;
        isDone: boolean;
        rawCmd: WebCmd;
        savedHeight: number;
        opts: RendererOpts;
        lineState: LineStateType;
        api: RendererModelContainerApi;
        ptyDataSource: (termContext: TermContextUnion) => Promise<PtyDataType>;
    };

    type RendererModel = {
        initialize: (params: RendererModelInitializeParams) => void;
        dispose: () => void;
        reload: (delayMs: number) => void;
        giveFocus: () => void;
        updateOpts: (opts: RendererOptsUpdate) => void;
        setIsDone: () => void;
        receiveData: (pos: number, data: Uint8Array, reason?: string) => void;
        updateHeight: (newHeight: number) => void;
    };

    type SimpleBlobRendererComponent = React.ComponentType<{
        data: ExtBlob;
        readOnly?: boolean;
        notFound?: boolean;
        isSelected?: boolean;
        rendererApi?: RendererModelContainerApi;
        shouldFocus?: boolean;
        cmdstr?: string;
        cwd?: string;
        exitcode?: number;
        context: RendererContext;
        opts: RendererOpts;
        savedHeight: number;
        scrollToBringIntoViewport?: () => void;
        lineState?: LineStateType;
    }>;
    type FullRendererComponent = React.ComponentType<{ model: any }>;

    type WindowSize = {
        height: number;
        width: number;
    };

    type PtyDataType = {
        pos: number;
        data: Uint8Array;
    };

    type TermThemeType = {
        [k: string]: string | null;
    };

    type FeOptsType = {
        termfontsize: number;
        termfontfamily: string;
        theme: NativeThemeSource;
        termtheme: TermThemeType;
    };

    type ConfirmFlagsType = {
        [k: string]: boolean;
    };

    type ClientOptsType = {
        notelemetry: boolean;
        noreleasecheck: boolean;
        acceptedtos: number;
        confirmflags: ConfirmFlagsType;
        mainsidebar: {
            collapsed: boolean;
            width: number;
        };
        rightsidebar: {
            collapsed: boolean;
            width: number;
        };
        globalshortcut: string;
        globalshortcutenabled: boolean;
        webgl: boolean;
        autocompleteenabled: boolean = true;
    };

    type ReleaseInfoType = {
        latestversion: string;
    };

    type ClientWinSize = {
        width: number;
        height: number;
        top: number;
        left: number;
        fullscreen: boolean;
    };

    type KeyModsType = {
        meta?: boolean;
        ctrl?: boolean;
        alt?: boolean;
        shift?: boolean;
    };

    type ClientDataType = {
        clientid: string;
        userid: string;
        feopts: FeOptsType;
        clientopts: ClientOptsType;
        cmdstoretype: "session" | "screen";
        dbversion: number;
        openaiopts?: OpenAIOptsType;
        releaseinfo?: ReleaseInfoType;
        winsize: ClientWinSize;
    };

    type OpenAIOptsType = {
        model?: string;
        apitoken?: string;
        maxtokens?: number;
        maxchoices?: number;
        baseurl?: string;
    };

    type PlaybookType = {
        playbookid: string;
        playbookname: string;
        description: string;
        entryids: string[];
        entries: PlaybookEntryType[];
    };

    type PlaybookEntryType = {
        entryid: string;
        playbookid: string;
        alias: string;
        cmdstr: string;
        description: string;
        createdts: number;
        updatedts: number;
        remove: boolean;
    };

    type AlertMessageType = {
        title?: string;
        message: string;
        confirm?: boolean;
        markdown?: boolean;
        confirmflag?: string;
    };

    type HistorySearchParams = {
        offset: number;
        rawOffset: number;
        searchText?: string;
        searchSessionId?: string;
        searchRemoteId?: string;
        fromTs?: number;
        noMeta?: boolean;
        filterCmds?: boolean;
    };

    type UserInputRequest = {
        requestid: string;
        querytext: string;
        responsetype: string;
        title: string;
        markdown: boolean;
        timeoutms: number;
        checkboxmsg: string;
        publictext: boolean;
    };

    type UserInputResponsePacket = {
        type: string;
        requestid: string;
        text?: string;
        confirm?: boolean;
        errormsg?: string;
        checkboxstat?: boolean;
    };

    type RenderModeType = "normal" | "collapsed" | "expanded";

    type WebScreen = {
        screenid: string;
        sharename: string;
        vts: number;
        selectedline: number;
    };

    type WebLine = {
        screenid: string;
        lineid: string;
        ts: number;
        linenum: number;
        linetype: string;
        text: string;
        contentheight: number;
        renderer: string;
        archived: boolean;
        vts: number;
    };

    type WebRemote = {
        remoteid: string;
        alias: string;
        canonicalname: string;
        name: string;
        homedir: string;
        isroot: boolean;
    };

    type WebCmd = {
        screenid: string;
        lineid: string;
        remote: WebRemote;
        cmdstr: string;
        rawcmdstr: string;
        festate: Record<string, string>;
        termopts: TermOptsType;
        status: string;
        cmdpid: number;
        remotepid: number;
        donets: number;
        exitcode: number;
        durationms: number;
        rtnstate: boolean;
        rtnstatestr: string;
        vts: number;
    };

    type WebFullScreen = {
        screenid: string;
        screen: WebScreen;
        lines: WebLine[];
        cmds: WebCmd[];
        cmdptymap: Record<string, number>;
        vts: number;
    };

    type PtyDataUpdate = {
        screenid: string;
        lineid: string;
        ptypos: number;
        data: string;
    };

    type WebShareWSMessage = {
        type: string;
        screenid: string;
        viewkey: string;
    };

    type LineInterface = {
        lineid: string;
        linenum: number;
        ts: number;
    };

    type LineFactoryProps = {
        line: LineInterface;
        width: number;
        visible: OV<boolean>;
        staticRender: boolean;
        onHeightChange: LineHeightChangeCallbackType;
        overrideCollapsed: OV<boolean>;
        topBorder: boolean;
        renderMode: RenderModeType;
        noSelect?: boolean;
    };

    type RendererContainerType = {
        registerRenderer: (lineId: string, model: RendererModel) => void;
        unloadRenderer: (lineId: string) => void;
    };

    type CommandRtnType = {
        success: boolean;
        error?: string;
        update?: UpdatePacket;
    };

    type EphemeralCommandOutputType = {
        stdout: string;
        stderr: string;
    };

    type EphemeralCommandResponsePacketType = {
        stdouturl?: string;
        stderrurl?: string;
    };

    type LineHeightChangeCallbackType = (lineNum: number, newHeight: number, oldHeight: number) => void;

    type OpenAIPacketType = {
        type: string;
        model: string;
        created: number;
        finish_reason: string;
        usage: Record<string, number>;
        index: number;
        text: string;
        error: string;
    };

    type FileInfoType = {
        type: string;
        name: string;
        size: number;
        modts: number;
        isdir: boolean;
        perm: number;
        notfound: boolean;
        modestr?: string;
        path?: string;
        outputpos?: number;
    };

    type ExtBlob = Blob & {
        notFound: boolean;
        name?: string;
    };

    type ExtFile = File & {
        notFound: boolean;
    };

    type ModalStoreEntry = {
        id: string;
        component: React.ComponentType;
        uniqueKey: string;
        props?: any;
    };

    type StrWithPos = {
        str: string;
        pos: number;
    };

    type LineFocusType = {
        cmdInputFocus: boolean;
        lineid?: string;
        linenum?: number;
        screenid?: string;
    };

    type LineContainerType = {
        loadTerminalRenderer: (elem: Element, line: LineType, cmd: Cmd, width: number) => void;
        registerRenderer: (lineId: string, renderer: RendererModel) => void;
        unloadRenderer: (lineId: string) => void;
        getIsFocused: (lineNum: number) => boolean;
        getTermWrap: (lineId: string) => TermWrap;
        getRenderer: (lineId: string) => RendererModel;
        getFocusType: () => FocusTypeStrs;
        getSelectedLine: () => number;
        getCmd: (line: LineType) => Cmd;
        setLineFocus: (lineNum: number, focus: boolean) => void;
        getUsedRows: (context: RendererContext, line: LineType, cmd: Cmd, width: number) => number;
        getContentHeight: (context: RendererContext) => number;
        setContentHeight: (context: RendererContext, height: number) => void;
        getMaxContentSize(): WindowSize;
        getIdealContentSize(): WindowSize;
        isSidebarOpen(): boolean;
        isLineIdInSidebar(lineId: string): boolean;
        getContainerType(): LineContainerStrs;
    };

    // the "environment" for computing a line's height (stays constant for a given term font family / size)
    type LineHeightEnv = {
        fontSize: number;
        fontSizeSm: number;
        lineHeight: number;
        lineHeightSm: number;
        pad: number;
    };

    // the "variables" for computing a line's height (changes per line)
    type LineChromeHeightVars = {
        numCmdLines: number;
        zeroHeight: boolean;
        hasLine2: boolean;
    };

    type MonoFontSize = {
        height: number;
        width: number;
        fontSize: number;
        pad: number;
    };

    type KeyModsType = {
        meta?: boolean;
        ctrl?: boolean;
        alt?: boolean;
        shift?: boolean;
    };

    type ElectronApi = {
        hideWindow: () => void;
        toggleDeveloperTools: () => void;
        getId: () => string;
        getIsDev: () => boolean;
        getPlatform: () => string;
        getAuthKey: () => string;
        getWaveSrvStatus: () => boolean;
        getInitialTermFontFamily: () => string;
        getShouldUseDarkColors: () => boolean;
        getNativeThemeSource: () => NativeThemeSource;
        setNativeThemeSource: (source: NativeThemeSource) => void;
        onNativeThemeUpdated: (callback: () => void) => void;
        restartWaveSrv: () => boolean;
        reloadWindow: () => void;
        openExternalLink: (url: string) => void;
        reregisterGlobalShortcut: (shortcut: string) => void;
        changeAutoUpdate: (enabled: boolean) => void;
        installAppUpdate: () => void;
        getAppUpdateStatus: () => AppUpdateStatusType;
        onAppUpdateStatus: (callback: (status: AppUpdateStatusType) => void) => void;
        onZoomChanged: (callback: () => void) => void;
        onMenuItemAbout: (callback: () => void) => void;
        contextEditMenu: (position: { x: number; y: number }, opts: ContextMenuOpts) => void;
        onWaveSrvStatusChange: (callback: (status: boolean, pid: number) => void) => void;
        getLastLogs: (numOfLines: number, callback: (logs: any) => void) => void;
        onToggleDevUI: (callback: () => void) => void;
        showContextMenu: (menu: ElectronContextMenuItem[], position: { x: number; y: number }) => void;
        onContextMenuClick: (callback: (id: string) => void) => void;
        pathBaseName: (path: string) => string;
        pathSep: () => string;
    };

    type ElectronContextMenuItem = {
        id: string; // unique id, used for communication
        label: string;
        role?: string; // electron role (optional)
        type?: "separator" | "normal" | "submenu";
        submenu?: ElectronContextMenuItem[];
    };

    type ContextMenuItem = {
        label?: string;
        type?: "separator" | "normal" | "submenu";
        role?: string; // electron role (optional)
        click?: () => void; // not required if role is set
        submenu?: ContextMenuItem[];
    };
}

export {};
