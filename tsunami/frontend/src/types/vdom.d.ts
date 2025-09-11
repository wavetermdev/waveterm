// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// rpctypes.VDomBackendOpts
type VDomBackendOpts = {
    globalkeyboardevents?: boolean;
    title?: string;
    faviconpath?: string;
};

// rpctypes.VDomBackendUpdate
type VDomBackendUpdate = {
    type: "backendupdate";
    ts: number;
    serverid: string;
    opts?: VDomBackendOpts;
    haswork?: boolean;
    fullupdate?: boolean;
    renderupdates?: VDomRenderUpdate[];
    transferelems?: VDomTransferElem[];
    transfertext?: VDomText[];
    refoperations?: VDomRefOperation[];
    messages?: VDomMessage[];
};

// rpctypes.RenderedElem
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
    keydata?: VDomKeyboardEvent;
    mousedata?: VDomPointerData;
};

// vdom.VDomFrontendUpdate
type VDomFrontendUpdate = {
    type: "frontendupdate";
    ts: number;
    clientid: string;
    forcetakeover?: boolean;
    correlationid?: string;
    reason?: string;
    dispose?: boolean;
    resync?: boolean;
    rendercontext: VDomRenderContext;
    events?: VDomEvent[];
    refupdates?: VDomRefUpdate[];
    messages?: VDomMessage[];
};

// vdom.VDomFunc
type VDomFunc = {
    type: "func";
    stoppropagation?: boolean;
    preventdefault?: boolean;
    globalevent?: string;
    keys?: string[];
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

// rpctypes.VDomRefUpdate
type VDomRefUpdate = {
    refid: string;
    hascurrent: boolean;
    position?: VDomRefPosition;
};

// rpctypes.VDomRenderContext
type VDomRenderContext = {
    focused: boolean;
    width: number;
    height: number;
    rootrefid: string;
    background?: boolean;
};

// rpctypes.VDomRenderUpdate
type VDomRenderUpdate = {
    updatetype: "root" | "append" | "replace" | "remove" | "insert";
    waveid?: string;
    vdomwaveid?: string;
    vdom?: VDomElem;
    index?: number;
};

// rpctypes.VDomTransferElem
type VDomTransferElem = {
    waveid?: string;
    tag: string;
    props?: { [key: string]: any };
    children?: string[];
    text?: string;
};

// rpctypes.VDomText
type VDomText = {
    id: number;
    text: string;
};

// rpctypes.VDomUrlRequestResponse
type VDomUrlRequestResponse = {
    statuscode?: number;
    headers?: { [key: string]: string };
    body?: Uint8Array;
};

// vdom.VDomKeyboardEvent
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

// vdom.VDomPointerData
type VDomPointerData = {
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
