import * as mobx from "mobx";

type SessionDataType = {
    sessionid : string,
    name : string,
    activescreenid : string,
    windows : WindowDataType[],
    screens : ScreenDataType[],
    screenwindows : ScreenWindowType[],
    cmds : CmdDataType[],
    remove : boolean,
};

type LineType = {
    sessionid : string,
    windowid : string,
    lineid : number,
    ts : number,
    userid : string,
    linetype : string,
    text : string,
    cmdid : string,
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
};

type RemoteType = {
    remotetype : string,
    remoteid : string,
    remotename : string,
    remotevars : Record<string, string>,
    status : string,
    defaultstate : RemoteStateType,
};

type RemoteStateType = {
    cwd : string,
};

type RemoteInstanceType = {
    riid : string,
    name : string,
    sessionid : string,
    windowid : string,
    remoteid : string,
    sessionscope : boolean,
    state : RemoteStateType,
}

type WindowDataType = {
    sessionid : string,
    windowid : string,
    curremote : string,
    lines : LineType[],
    history : HistoryItem[],
    cmds : CmdDataType[],
    remotes : RemoteInstanceType[],
    remove : boolean,
};

type HistoryItem = {
    cmdstr : string,
};

type CmdRemoteStateType = {
    remoteid : string
    remotename : string,
    cwd : string,
};

type FeCmdPacketType = {
    type : string,
    sessionid : string,
    windowid : string,
    userid : string,
    cmdstr : string,
    remotestate : CmdRemoteStateType,
};

type WatchScreenPacketType = {
    type : string,
    sessionid : string,
    screenid : string,
};

type TermOptsType = {
    rows : number,
    cols : number,
    flexrows? : boolean,
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
    remoteid : string,
    cmdstr : string,
    remotestate : RemoteStateType,
    termopts : TermOptsType,
    status : string,
    startpk : CmdStartPacketType,
    donepk : CmdDonePacketType,
    runout : any[],
    usedrows : number,
};

type PtyDataUpdateType = {
    sessionid : string,
    cmdid : string,
    ptypos : number,
    ptydata64 : string,
    ptydatalen : number,
};

export type {SessionDataType, LineType, RemoteType, RemoteStateType, RemoteInstanceType, WindowDataType, HistoryItem, CmdRemoteStateType, FeCmdPacketType, TermOptsType, CmdStartPacketType, CmdDonePacketType, CmdDataType, ScreenDataType, ScreenOptsType, ScreenWindowType, LayoutType, PtyDataUpdateType};
