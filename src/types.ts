import * as mobx from "mobx";

type SessionDataType = {
    sessionid : string,
    name : string,
    notifynum : number,
    activescreenid : string,
    sessionidx : number,
    screens : ScreenDataType[],
    remotes : RemoteInstanceType[],

    // for updates
    remove? : boolean,
    full? : boolean,
};

type LineType = {
    sessionid : string,
    windowid : string,
    userid : string,
    lineid : string,
    ts : number,
    linenum : number,
    linenumtemp : boolean,
    linelocal : boolean,
    linetype : string,
    text : string,
    cmdid : string,
    contentheight : number,
    ephemeral? : boolean,
    remove? : boolean,
};

type ScreenOptsType = {
    tabcolor? : string,
}

type ScreenDataType = {
    sessionid : string,
    screenid : string,
    screenidx : number,
    activewindowid : string,
    name : string,
    windows : ScreenWindowType[],
    screenopts : ScreenOptsType,

    // for updates
    remove? : boolean,
    full? : boolean,
};

type LayoutType = {
    type : string,
    parent? : string,
    zindex? : number,
    float? : boolean,
    top? : string,
    bottom? : string,
    left? : string,
    right? : string,
    width? : string,
    height? : string,
};

type ScreenWindowType = {
    sessionid : string,
    screenid : string,
    windowid : string,
    name : string,
    layout : LayoutType,
    selectedline : number,
    focustype : "input"|"cmd"|"cmd-fg",
    anchor : {anchorline : number, anchoroffset : number},

    // for updates
    remove? : boolean,
};

type RemoteType = {
    remotetype : string,
    remoteid : string,
    physicalid : string,
    remotealias : string,
    remotecanonicalname : string,
    remotevars : Record<string, string>,
    status : string,
    errorstr : string,
    installstatus : string,
    installerrorstr : string,
    defaultstate : RemoteStateType,
    connectmode : string,
    autoinstall : boolean,
    remoteidx : number,
    archived : boolean,
    uname : string,
    mshellversion : string,
    needsmshellupgrade : boolean,
    waitingforpassword : boolean,
    local : boolean,
    remove? : boolean,
};

type RemoteStateType = {
    cwd : string,
    env0 : string, // in base64 "env -0" form
};

type RemoteInstanceType = {
    riid : string,
    name : string,
    sessionid : string,
    windowid : string,
    remoteownerid : string,
    remoteid : string,
    state : RemoteStateType,

    remove? : boolean,
}

type RemotePtrType = {
    ownerid : string,
    remoteid : string,
    name : string,
};

type WindowDataType = {
    sessionid : string,
    windowid : string,
    curremote : RemotePtrType,
    nextlinenum : number,
    lines : LineType[],
    cmds : CmdDataType[],

    // for updates
    remove? : boolean,
};

type HistoryItem = {
    historyid : string,
    ts : number,
    userid : string,
    sessionid : string,
    screenid : string,
    windowid : string,
    lineid : string,
    haderror : boolean,
    cmdid : string,
    cmdstr : string,
    remove : boolean,
    remote : RemotePtrType,
    ismetacmd : boolean,
    historynum : string,
};

type CmdRemoteStateType = {
    remoteid : string
    remotename : string,
    cwd : string,
};

type UIContextTermOptsType = {
    rows? : number,
    cols? : number,
    term? : string,
    maxptysize? : number,
};

type UIContextType = {
    sessionid : string,
    screenid : string,
    windowid : string,
    remote : RemotePtrType,
    termopts : UIContextTermOptsType,
};

type FeCmdPacketType = {
    type : string,
    metacmd : string,
    metasubcmd? : string,
    args : string[],
    kwargs : Record<string, string>;
    rawstr? : string,
    uicontext : UIContextType,
    interactive : boolean,
};

type FeInputPacketType = {
    type : string,
    ck : string,
    remote : RemotePtrType,
    inputdata64? : string,
    signame? : string,
    winsize? : TermWinSize,
};

type RemoteInputPacketType = {
    type : string,
    remoteid : string,
    inputdata64 : string,
};

type WatchScreenPacketType = {
    type : string,
    sessionid : string,
    screenid : string,
    connect : boolean,
};

type TermWinSize = {
    rows : number,
    cols : number,
}

type TermOptsType = {
    rows : number,
    cols : number,
    flexrows? : boolean,
    maxptysize? : number,
};

type CmdStartPacketType = {
    type : string,
    respid : string,
    ts : number,
    ck : string,
    pid : number,
    mshellpid : number,
};

type CmdDonePacketType = {
    type : string,
    ts : number,
    ck : string,
    exitcode : number,
    durationms : number,
};

type CmdDataType = {
    sessionid : string,
    cmdid : string,
    remote : RemotePtrType,
    cmdstr : string,
    remotestate : RemoteStateType,
    termopts : TermOptsType,
    origtermopts : TermOptsType,
    status : string,
    startpk : CmdStartPacketType,
    donepk : CmdDonePacketType,
    runout : any[],
    rtnstate : boolean,
    remove? : boolean,
};

type PtyDataUpdateType = {
    sessionid : string,
    cmdid : string,
    remoteid : string,
    ptypos : number,
    ptydata64 : string,
    ptydatalen : number,
};

type ModelUpdateType = {
    sessions? : SessionDataType[],
    activesessionid? : string,
    window? : WindowDataType,
    screenwindows? : ScreenWindowType[],
    line? : LineType,
    cmd? : CmdDataType,
    info? : InfoType,
    cmdline? : CmdLineUpdateType,
    remotes? : RemoteType[],
    history? : HistoryInfoType,
    interactive : boolean,
    connect? : boolean,
};

type HistoryInfoType = {
    historytype : "global" | "session" | "window",
    sessionid : string,
    windowid : string,
    items : HistoryItem[],
    show : boolean,
};

type CmdLineUpdateType = {
    cmdline : string,
    cursorpos : number,
};

type RemoteEditType = {
    remoteedit : boolean,
    remoteid? : string,
    errorstr? : string,
    infostr? : string,
    keystr? : string,
    haspassword? : boolean,
};

type InfoType = {
    infotitle? : string,
    infomsg? : string,
    infoerror? : string,
    infolines? : string[],
    infocomps? : string[],
    infocompsmore? : boolean,
    timeoutms? : number,
    ptyremoteid? : string,
    remoteedit? : RemoteEditType,
    remoteshowall? : boolean,
};

type HistoryQueryOpts = {
    queryType : "global" | "session" | "window";
    limitRemote : boolean,
    limitRemoteInstance : boolean,
    limitUser : boolean,
    queryStr : string,
    maxItems : number,
    includeMeta : boolean,
    fromTs : number,
};

type UpdateMessage = PtyDataUpdateType | ModelUpdateType;

export type {SessionDataType, LineType, RemoteType, RemoteStateType, RemoteInstanceType, WindowDataType, HistoryItem, CmdRemoteStateType, FeCmdPacketType, TermOptsType, CmdStartPacketType, CmdDonePacketType, CmdDataType, ScreenDataType, ScreenOptsType, ScreenWindowType, LayoutType, PtyDataUpdateType, ModelUpdateType, UpdateMessage, InfoType, CmdLineUpdateType, RemotePtrType, UIContextType, HistoryInfoType, HistoryQueryOpts, WatchScreenPacketType, TermWinSize, FeInputPacketType, RemoteInputPacketType, RemoteEditType};
