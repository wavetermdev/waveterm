// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobx from "mobx";

type ShareModeType = "local" | "web";
type FocusTypeStrs = "input" | "cmd";
type HistoryTypeStrs = "global" | "session" | "screen";
type RemoteStatusTypeStrs = "connected" | "connecting" | "disconnected" | "error";
type LineContainerStrs = "main" | "sidebar" | "history";

type OV<V> = mobx.IObservableValue<V>;

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
    full?: boolean;
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
    full?: boolean;
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
    errorstr: string;
    installstatus: string;
    installerrorstr: string;
    defaultfestate: Record<string, string>;
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

type FeCmdPacketType = {
    type: string;
    metacmd: string;
    metasubcmd?: string;
    args: string[];
    kwargs: Record<string, string>;
    rawstr?: string;
    uicontext: UIContextType;
    interactive: boolean;
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
    donets: number;
    exitcode: number;
    durationms: number;
    runout: any[];
    rtnstate: boolean;
    remove?: boolean;
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

type ModelUpdateType = {
    interactive: boolean;
    sessions?: SessionDataType[];
    activesessionid?: string;
    screens?: ScreenDataType[];
    screenlines?: ScreenLinesType;
    line?: LineType;
    lines?: LineType[];
    cmd?: CmdDataType;
    info?: InfoType;
    cmdline?: StrWithPos;
    remotes?: RemoteType[];
    history?: HistoryInfoType;
    connect?: boolean;
    mainview?: string;
    bookmarks?: BookmarkType[];
    selectedbookmark?: string;
    clientdata?: ClientDataType;
    historyviewdata?: HistoryViewDataType;
    remoteview?: RemoteViewType;
    openaicmdinfochat?: OpenAICmdInfoChatMessageType[];
    alertmessage?: AlertMessageType;
    screenstatusindicator?: ScreenStatusIndicatorUpdateType;
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
    infomsghtml?: boolean;
    websharelink?: boolean;
    infoerror?: string;
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

type UpdateMessage = PtyDataUpdateType | ModelUpdateType;

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

type FeOptsType = {
    termfontsize: number;
};

type ConfirmFlagsType = {
    [k: string]: boolean;
};

type ClientOptsType = {
    notelemetry: boolean;
    noreleasecheck: boolean;
    acceptedtos: number;
    confirmflags: ConfirmFlagsType;
    sidebar: {
        [key in SidebarNameType]: {
            collapsed: boolean;
            width: number;
        };
    };
};

type ReleaseInfoType = {
    latestversion: string;
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
};

type OpenAIOptsType = {
    model?: string;
    apitoken?: string;
    maxtokens?: number;
    maxchoices?: number;
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
    name: string;
    size: number;
    modts: number;
    isdir: boolean;
    perm: number;
    notfound: boolean;
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
};

type StrWithPos = {
    str: string;
    pos: number;
};

type SidebarNameType = "main";

export type {
    SessionDataType,
    LineStateType,
    LineType,
    RemoteType,
    RemoteStateType,
    RemoteInstanceType,
    HistoryItem,
    CmdRemoteStateType,
    FeCmdPacketType,
    TermOptsType,
    CmdDataType,
    ScreenViewOptsType,
    ScreenSidebarOptsType,
    ScreenDataType,
    ScreenOptsType,
    PtyDataUpdateType,
    ModelUpdateType,
    UpdateMessage,
    InfoType,
    CmdLineUpdateType,
    RemotePtrType,
    UIContextType,
    HistoryInfoType,
    HistoryQueryOpts,
    WatchScreenPacketType,
    TermWinSize,
    FeInputPacketType,
    RemoteInputPacketType,
    RemoteEditType,
    ContextMenuOpts,
    RendererContext,
    WindowSize,
    RendererModel,
    PtyDataType,
    BookmarkType,
    ClientDataType,
    PlaybookType,
    PlaybookEntryType,
    HistoryViewDataType,
    RenderModeType,
    AlertMessageType,
    HistorySearchParams,
    ScreenLinesType,
    FocusTypeStrs,
    HistoryTypeStrs,
    RendererOpts,
    RendererPluginType,
    SimpleBlobRendererComponent,
    RendererModelContainerApi,
    RendererModelInitializeParams,
    RendererOptsUpdate,
    WebShareOpts,
    RemoteStatusTypeStrs,
    WebFullScreen,
    WebScreen,
    WebLine,
    WebCmd,
    RemoteTermContext,
    TermContextUnion,
    WebRemote,
    PtyDataUpdate,
    WebShareWSMessage,
    LineHeightChangeCallbackType,
    LineFactoryProps,
    LineInterface,
    RendererContainerType,
    RemoteViewType,
    CommandRtnType,
    OpenAIPacketType,
    FileInfoType,
    ExtBlob,
    ExtFile,
    LineContainerStrs,
    ModalStoreEntry,
    StrWithPos,
    CmdInputTextPacketType,
    OpenAICmdInfoChatMessageType,
    ScreenStatusIndicatorUpdateType,
    SidebarNameType,
};

export { StatusIndicatorLevel };
