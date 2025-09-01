// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// vdom.VDomAsyncInitiationRequest
type VDomAsyncInitiationRequest = {
    type: "asyncinitiationrequest";
    ts: number;
    blockid?: string;
};

// vdom.VDomBackendOpts
type VDomBackendOpts = {
    closeonctrlc?: boolean;
    globalkeyboardevents?: boolean;
    globalstyles?: boolean;
};

// vdom.VDomBackendUpdate
type VDomBackendUpdate = {
    type: "backendupdate";
    ts: number;
    opts?: VDomBackendOpts;
    haswork?: boolean;
    renderupdates?: VDomRenderUpdate[];
    transferelems?: VDomTransferElem[];
    statesync?: VDomStateSync[];
    refoperations?: VDomRefOperation[];
    messages?: VDomMessage[];
};

// vdom.VDomBinding
type VDomBinding = {
    type: "binding";
    bind: string;
};

// vdom.VDomCreateContext
type VDomCreateContext = {
    type: "createcontext";
    ts: number;
    meta?: MetaType;
    target?: VDomTarget;
    persist?: boolean;
};

// vdom.VDomElem
type VDomElem = {
    waveid?: string;
    tag: string;
    props?: { [key: string]: any };
    children?: VDomElem[];
    text?: string;
};

// vdom.VDomEvent
type VDomEvent = {
    waveid: string;
    eventtype: string;
    globaleventtype?: string;
    targetvalue?: string;
    targetchecked?: boolean;
    targetname?: string;
    targetid?: string;
    keydata?: WaveKeyboardEvent;
    mousedata?: WavePointerData;
};

// vdom.VDomFrontendUpdate
type VDomFrontendUpdate = {
    type: "frontendupdate";
    ts: number;
    clientid: string;
    forcetakeover?: boolean;
    correlationid?: string;
    dispose?: boolean;
    resync?: boolean;
    rendercontext: VDomRenderContext;
    events?: VDomEvent[];
    statesync?: VDomStateSync[];
    refupdates?: VDomRefUpdate[];
    messages?: VDomMessage[];
};

// vdom.VDomFunc
type VDomFunc = {
    type: "func";
    stoppropagation?: boolean;
    preventdefault?: boolean;
    globalevent?: string;
    "#keys"?: string[];
};

// vdom.VDomMessage
type VDomMessage = {
    messagetype: string;
    message: string;
    stacktrace?: string;
    params?: any[];
};

// vdom.VDomRef
type VDomRef = {
    type: "ref";
    refid: string;
    trackposition?: boolean;
    position?: VDomRefPosition;
    hascurrent?: boolean;
};

// vdom.VDomRefOperation
type VDomRefOperation = {
    refid: string;
    op: string;
    params?: any[];
    outputref?: string;
};

// vdom.VDomRefPosition
type VDomRefPosition = {
    offsetheight: number;
    offsetwidth: number;
    scrollheight: number;
    scrollwidth: number;
    scrolltop: number;
    boundingclientrect: DomRect;
};

// vdom.VDomRefUpdate
type VDomRefUpdate = {
    refid: string;
    hascurrent: boolean;
    position?: VDomRefPosition;
};

// vdom.VDomRenderContext
type VDomRenderContext = {
    focused: boolean;
    width: number;
    height: number;
    rootrefid: string;
    background?: boolean;
};

// vdom.VDomRenderUpdate
type VDomRenderUpdate = {
    updatetype: "root" | "append" | "replace" | "remove" | "insert";
    waveid?: string;
    vdomwaveid?: string;
    vdom?: VDomElem;
    index?: number;
};

// vdom.VDomStateSync
type VDomStateSync = {
    atom: string;
    value: any;
};

// vdom.VDomTarget
type VDomTarget = {
    newblock?: boolean;
    magnified?: boolean;
    toolbar?: VDomTargetToolbar;
};

// vdom.VDomTargetToolbar
type VDomTargetToolbar = {
    toolbar: boolean;
    height?: string;
};

// vdom.VDomTransferElem
type VDomTransferElem = {
    waveid?: string;
    tag: string;
    props?: { [key: string]: any };
    children?: string[];
    text?: string;
};

// wshrpc.VDomUrlRequestData
type VDomUrlRequestData = {
    method: string;
    url: string;
    headers: { [key: string]: string };
    body?: string;
};

// wshrpc.VDomUrlRequestResponse
type VDomUrlRequestResponse = {
    statuscode?: number;
    headers?: { [key: string]: string };
    body?: Uint8Array;
};

// Additional types from rpctypes that were missing
type VDomKeyboardEvent = {
    type: string;
    key: string;
    code: string;
    shift?: boolean;
    control?: boolean;
    alt?: boolean;
    meta?: boolean;
    cmd?: boolean;
    option?: boolean;
    repeat?: boolean;
    location?: number;
};

type WaveKeyboardEvent = {
    type: "keydown" | "keyup" | "keypress" | "unknown";
    key: string;
    code: string;
    repeat?: boolean;
    location?: number;
    shift?: boolean;
    control?: boolean;
    alt?: boolean;
    meta?: boolean;
    cmd?: boolean;
    option?: boolean;
};

type WavePointerData = {
    button: number;
    buttons: number;
    clientx?: number;
    clienty?: number;
    pagex?: number;
    pagey?: number;
    screenx?: number;
    screeny?: number;
    movementx?: number;
    movementy?: number;
    shift?: boolean;
    control?: boolean;
    alt?: boolean;
    meta?: boolean;
    cmd?: boolean;
    option?: boolean;
};
