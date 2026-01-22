// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// rpctypes.VDomBackendOpts
type VDomBackendOpts = {
    globalkeyboardevents?: boolean;
    title?: string;
    shortdesc?: string;
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
    targetfiles?: VDomFileData[];
    keydata?: VDomKeyboardEvent;
    mousedata?: VDomPointerData;
    formdata?: VDomFormData;
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

// rpctypes.ModalConfig
type ModalConfig = {
    modalid: string;
    modaltype: "alert" | "confirm";
    icon?: string;
    title: string;
    text?: string;
    oktext?: string;
    canceltext?: string;
};

// rpctypes.ModalResult
type ModalResult = {
    modalid: string;
    confirm: boolean;
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

// vdom.VDomFormData
type VDomFormData = {
    action?: string;
    method: string;
    enctype: string;
    formid?: string;
    formname?: string;
    fields: { [key: string]: string[] };
    files: { [key: string]: VDomFileData[] };
};

// vdom.VDomFileData
type VDomFileData = {
    fieldname: string;
    name: string;
    size: number;
    type: string;
    data64?: string;
    error?: string;
};
