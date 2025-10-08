// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import debug from "debug";
import * as jotai from "jotai";

import { getOrCreateClientId } from "@/util/clientid";
import { adaptFromReactOrNativeKeyEvent } from "@/util/keyutil";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { getDefaultStore } from "jotai";
import { applyCanvasOp, restoreVDomElems } from "./model-utils";

const dlog = debug("wave:vdom");

type RefContainer = {
    refFn: (elem: HTMLElement) => void;
    vdomRef: VDomRef;
    elem: HTMLElement;
    updated: boolean;
};

function makeVDomIdMap(vdom: VDomElem, idMap: Map<string, VDomElem>) {
    if (vdom == null) {
        return;
    }
    if (vdom.waveid != null) {
        idMap.set(vdom.waveid, vdom);
    }
    if (vdom.children == null) {
        return;
    }
    for (let child of vdom.children) {
        makeVDomIdMap(child, idMap);
    }
}

function isBlank(v: string): boolean {
    return v == null || v === "";
}

function annotateEvent(event: VDomEvent, propName: string, reactEvent: React.SyntheticEvent) {
    if (reactEvent == null) {
        return;
    }
    if (propName == "onChange") {
        const changeEvent = reactEvent as React.ChangeEvent<any>;
        event.targetvalue = changeEvent.target?.value;
        event.targetchecked = changeEvent.target?.checked;
    }
    if (propName == "onClick" || propName == "onMouseDown") {
        const mouseEvent = reactEvent as React.MouseEvent<any>;
        event.mousedata = {
            button: mouseEvent.button,
            buttons: mouseEvent.buttons,
            alt: mouseEvent.altKey,
            control: mouseEvent.ctrlKey,
            shift: mouseEvent.shiftKey,
            meta: mouseEvent.metaKey,
            clientx: mouseEvent.clientX,
            clienty: mouseEvent.clientY,
            pagex: mouseEvent.pageX,
            pagey: mouseEvent.pageY,
            screenx: mouseEvent.screenX,
            screeny: mouseEvent.screenY,
            movementx: mouseEvent.movementX,
            movementy: mouseEvent.movementY,
        };
        if (PLATFORM == PlatformMacOS) {
            event.mousedata.cmd = event.mousedata.meta;
            event.mousedata.option = event.mousedata.alt;
        } else {
            event.mousedata.cmd = event.mousedata.alt;
            event.mousedata.option = event.mousedata.meta;
        }
    }
    if (propName == "onKeyDown") {
        const waveKeyEvent = adaptFromReactOrNativeKeyEvent(reactEvent as React.KeyboardEvent);
        event.keydata = waveKeyEvent;
    }
}

export class TsunamiModel {
    clientId: string;
    serverId: string;
    viewRef: React.RefObject<HTMLDivElement> = { current: null };
    vdomRoot: jotai.PrimitiveAtom<VDomElem> = jotai.atom();
    refs: Map<string, RefContainer> = new Map(); // key is refid
    batchedEvents: VDomEvent[] = [];
    messages: VDomMessage[] = [];
    needsResync: boolean = true;
    vdomNodeVersion: WeakMap<VDomElem, jotai.PrimitiveAtom<number>> = new WeakMap();
    rootRefId: string = crypto.randomUUID();
    backendOpts: VDomBackendOpts;
    shouldDispose: boolean;
    disposed: boolean;
    hasPendingRequest: boolean;
    needsUpdate: boolean;
    maxNormalUpdateIntervalMs: number = 100;
    needsImmediateUpdate: boolean;
    lastUpdateTs: number = 0;
    queuedUpdate: { timeoutId: any; ts: number; quick: boolean };
    contextActive: jotai.PrimitiveAtom<boolean>;
    serverEventSource: EventSource;
    refOutputStore: Map<string, any> = new Map();
    globalVersion: jotai.PrimitiveAtom<number> = jotai.atom(0);
    hasBackendWork: boolean = false;
    noPadding: jotai.PrimitiveAtom<boolean>;
    cachedFaviconPath: string | null = null;
    cachedTitle: string | null = null;
    cachedShortDesc: string | null = null;
    reason: string | null = null;

    constructor() {
        this.clientId = getOrCreateClientId();
        this.contextActive = jotai.atom(false);
        this.reset();
        this.noPadding = jotai.atom(true);
        this.setupServerEventSource();
        this.queueUpdate(true, "initial");
    }

    dispose() {
        if (this.serverEventSource) {
            this.serverEventSource.close();
            this.serverEventSource = null;
        }
    }

    setupServerEventSource() {
        if (this.serverEventSource) {
            this.serverEventSource.close();
        }

        const url = `/api/updates?clientId=${encodeURIComponent(this.clientId)}`;
        this.serverEventSource = new EventSource(url);

        this.serverEventSource.addEventListener("asyncinitiation", (event) => {
            dlog("async-initiation SSE event received", event);
            this.queueUpdate(true, "asyncinitiation");
        });

        this.serverEventSource.addEventListener("error", (event) => {
            console.error("SSE connection error:", event);
        });

        this.serverEventSource.addEventListener("open", (event) => {
            dlog("SSE connection opened", event);
        });
    }

    reset() {
        if (this.serverEventSource) {
            this.serverEventSource.close();
            this.serverEventSource = null;
        }
        getDefaultStore().set(this.vdomRoot, null);
        this.refs.clear();
        this.batchedEvents = [];
        this.messages = [];
        this.needsResync = true;
        this.vdomNodeVersion = new WeakMap();
        this.rootRefId = crypto.randomUUID();
        this.backendOpts = {};
        this.shouldDispose = false;
        this.disposed = false;
        this.hasPendingRequest = false;
        this.needsUpdate = false;
        this.maxNormalUpdateIntervalMs = 100;
        this.needsImmediateUpdate = false;
        this.lastUpdateTs = 0;
        this.queuedUpdate = null;
        this.refOutputStore.clear();
        this.globalVersion = jotai.atom(0);
        this.hasBackendWork = false;
        this.reason = null;
        this.cachedTitle = null;
        this.cachedShortDesc = null;
        getDefaultStore().set(this.contextActive, false);
    }

    keyDownHandler(e: VDomKeyboardEvent): boolean {
        if (!this.backendOpts?.globalkeyboardevents) {
            return false;
        }
        if (e.cmd || e.meta) {
            return false;
        }
        this.batchedEvents.push({
            globaleventtype: "onKeyDown",
            waveid: null,
            eventtype: "onKeyDown",
            keydata: e,
        });
        this.queueUpdate(false, "globalkeyboard");
        return true;
    }

    hasRefUpdates() {
        for (let ref of this.refs.values()) {
            if (ref.updated) {
                return true;
            }
        }
        return false;
    }

    getRefUpdates(): VDomRefUpdate[] {
        let updates: VDomRefUpdate[] = [];
        for (let ref of this.refs.values()) {
            if (ref.updated || (ref.vdomRef.trackposition && ref.elem != null)) {
                const ru: VDomRefUpdate = {
                    refid: ref.vdomRef.refid,
                    hascurrent: ref.vdomRef.hascurrent,
                };
                if (ref.vdomRef.trackposition && ref.elem != null) {
                    ru.position = {
                        offsetheight: ref.elem.offsetHeight,
                        offsetwidth: ref.elem.offsetWidth,
                        scrollheight: ref.elem.scrollHeight,
                        scrollwidth: ref.elem.scrollWidth,
                        scrolltop: ref.elem.scrollTop,
                        boundingclientrect: ref.elem.getBoundingClientRect(),
                    };
                }
                updates.push(ru);
                ref.updated = false;
            }
        }
        return updates;
    }

    mergeReasons(newReason: string): string {
        if (!this.reason) {
            return newReason;
        }
        const existingReasons = this.reason.split(",");
        const newReasons = newReason.split(",");
        for (const reason of newReasons) {
            if (!existingReasons.includes(reason)) {
                existingReasons.push(reason);
            }
        }
        return existingReasons.join(",");
    }

    queueUpdate(quick: boolean = false, reason: string | null) {
        if (this.disposed) {
            return;
        }
        if (reason) {
            this.reason = this.mergeReasons(reason);
        }
        this.needsUpdate = true;
        let delay = 10;
        let nowTs = Date.now();
        if (delay > this.maxNormalUpdateIntervalMs) {
            delay = this.maxNormalUpdateIntervalMs;
        }
        if (quick) {
            if (this.queuedUpdate) {
                if (this.queuedUpdate.quick || this.queuedUpdate.ts <= nowTs) {
                    return;
                }
                clearTimeout(this.queuedUpdate.timeoutId);
                this.queuedUpdate = null;
            }
            let timeoutId = setTimeout(() => {
                this._sendRenderRequest(true);
            }, 0);
            this.queuedUpdate = { timeoutId: timeoutId, ts: nowTs, quick: true };
            return;
        }
        if (this.queuedUpdate) {
            return;
        }
        let lastUpdateDiff = nowTs - this.lastUpdateTs;
        let timeoutMs: number = null;
        if (lastUpdateDiff >= this.maxNormalUpdateIntervalMs) {
            // it has been a while since the last update, so use delay
            timeoutMs = delay;
        } else {
            timeoutMs = this.maxNormalUpdateIntervalMs - lastUpdateDiff;
        }
        if (timeoutMs < delay) {
            timeoutMs = delay;
        }
        let timeoutId = setTimeout(() => {
            this._sendRenderRequest(false);
        }, timeoutMs);
        this.queuedUpdate = { timeoutId: timeoutId, ts: nowTs + timeoutMs, quick: false };
    }

    async _sendRenderRequest(force: boolean) {
        this.queuedUpdate = null;
        if (this.disposed) {
            return;
        }
        if (this.hasPendingRequest) {
            if (force) {
                this.needsImmediateUpdate = true;
            }
            return;
        }
        if (!force && !this.needsUpdate) {
            return;
        }
        this.hasPendingRequest = true;
        this.needsImmediateUpdate = false;
        try {
            const feUpdate = this.createFeUpdate();
            dlog("fe-update", feUpdate);

            const response = await fetch("/api/render", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(feUpdate),
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // Check if EventSource connection is closed and reconnect if needed
            if (this.serverEventSource && this.serverEventSource.readyState === EventSource.CLOSED) {
                dlog("EventSource connection closed, reconnecting");
                this.setupServerEventSource();
            }

            const backendUpdate: VDomBackendUpdate = await response.json();
            if (backendUpdate !== null) {
                restoreVDomElems(backendUpdate);
                dlog("be-update", backendUpdate);
                this.handleBackendUpdate(backendUpdate);
            }
            dlog("update cycle done");
        } finally {
            this.lastUpdateTs = Date.now();
            this.hasPendingRequest = false;
        }
        if (this.needsImmediateUpdate) {
            this.queueUpdate(true, null); // reason should already be set, dont try to add a new one
        }
    }

    getOrCreateRefContainer(vdomRef: VDomRef): RefContainer {
        let container = this.refs.get(vdomRef.refid);
        if (container == null) {
            container = {
                refFn: (elem: HTMLElement) => {
                    container.elem = elem;
                    const hasElem = elem != null;
                    if (vdomRef.hascurrent != hasElem) {
                        container.updated = true;
                        vdomRef.hascurrent = hasElem;
                    }
                },
                vdomRef: vdomRef,
                elem: null,
                updated: false,
            };
            this.refs.set(vdomRef.refid, container);
        }
        return container;
    }

    getVDomNodeVersionAtom(vdom: VDomElem) {
        let atom = this.vdomNodeVersion.get(vdom);
        if (atom == null) {
            atom = jotai.atom(0);
            this.vdomNodeVersion.set(vdom, atom);
        }
        return atom;
    }

    incVDomNodeVersion(vdom: VDomElem) {
        if (vdom == null) {
            return;
        }
        const atom = this.getVDomNodeVersionAtom(vdom);
        getDefaultStore().set(atom, getDefaultStore().get(atom) + 1);
    }

    addErrorMessage(message: string) {
        this.messages.push({
            messagetype: "error",
            message: message,
        });
    }

    logTsunamiMeta(opts: any) {
        let hasChanges = false;
        const logObj: { title?: string; shortdesc?: string } = {};

        if (!isBlank(opts.title)) {
            if (opts.title !== this.cachedTitle) {
                hasChanges = true;
                this.cachedTitle = opts.title;
            }
            logObj.title = opts.title;
        }

        if (!isBlank(opts.shortdesc)) {
            if (opts.shortdesc !== this.cachedShortDesc) {
                hasChanges = true;
                this.cachedShortDesc = opts.shortdesc;
            }
            logObj.shortdesc = opts.shortdesc;
        }

        if (!hasChanges) {
            return;
        }

        console.log("TSUNAMI_META " + JSON.stringify(logObj));
    }

    handleRenderUpdates(update: VDomBackendUpdate, idMap: Map<string, VDomElem>) {
        if (!update.renderupdates) {
            return;
        }
        for (let renderUpdate of update.renderupdates) {
            if (renderUpdate.updatetype == "root") {
                getDefaultStore().set(this.vdomRoot, renderUpdate.vdom);
                continue;
            }
            if (renderUpdate.updatetype == "append") {
                let parent = idMap.get(renderUpdate.waveid);
                if (parent == null) {
                    this.addErrorMessage(`Could not find vdom with id ${renderUpdate.waveid} (for renderupdates)`);
                    continue;
                }
                if (parent.children == null) {
                    parent.children = [];
                }
                parent.children.push(renderUpdate.vdom);
                this.incVDomNodeVersion(parent);
                continue;
            }
            if (renderUpdate.updatetype == "replace") {
                let parent = idMap.get(renderUpdate.waveid);
                if (parent == null) {
                    this.addErrorMessage(`Could not find vdom with id ${renderUpdate.waveid} (for renderupdates)`);
                    continue;
                }
                if (renderUpdate.index < 0 || parent.children == null || parent.children.length <= renderUpdate.index) {
                    this.addErrorMessage(`Could not find child at index ${renderUpdate.index} (for renderupdates)`);
                    continue;
                }
                parent.children[renderUpdate.index] = renderUpdate.vdom;
                this.incVDomNodeVersion(parent);
                continue;
            }
            if (renderUpdate.updatetype == "remove") {
                let parent = idMap.get(renderUpdate.waveid);
                if (parent == null) {
                    this.addErrorMessage(`Could not find vdom with id ${renderUpdate.waveid} (for renderupdates)`);
                    continue;
                }
                if (renderUpdate.index < 0 || parent.children == null || parent.children.length <= renderUpdate.index) {
                    this.addErrorMessage(`Could not find child at index ${renderUpdate.index} (for renderupdates)`);
                    continue;
                }
                parent.children.splice(renderUpdate.index, 1);
                this.incVDomNodeVersion(parent);
                continue;
            }
            if (renderUpdate.updatetype == "insert") {
                let parent = idMap.get(renderUpdate.waveid);
                if (parent == null) {
                    this.addErrorMessage(`Could not find vdom with id ${renderUpdate.waveid} (for renderupdates)`);
                    continue;
                }
                if (parent.children == null) {
                    parent.children = [];
                }
                if (renderUpdate.index < 0 || parent.children.length < renderUpdate.index) {
                    this.addErrorMessage(`Could not find child at index ${renderUpdate.index} (for renderupdates)`);
                    continue;
                }
                parent.children.splice(renderUpdate.index, 0, renderUpdate.vdom);
                this.incVDomNodeVersion(parent);
                continue;
            }
            this.addErrorMessage(`Unknown updatetype ${renderUpdate.updatetype}`);
        }
    }

    getRefElem(refId: string): HTMLElement {
        if (refId == this.rootRefId) {
            return this.viewRef.current;
        }
        const ref = this.refs.get(refId);
        return ref?.elem;
    }

    handleRefOperations(update: VDomBackendUpdate, idMap: Map<string, VDomElem>) {
        if (update.refoperations == null) {
            return;
        }
        for (let refOp of update.refoperations) {
            const elem = this.getRefElem(refOp.refid);
            if (elem == null) {
                this.addErrorMessage(`Could not find ref with id ${refOp.refid}`);
                continue;
            }
            if (elem instanceof HTMLCanvasElement) {
                applyCanvasOp(elem, refOp, this.refOutputStore);
                continue;
            }
            if (refOp.op == "focus") {
                if (elem == null) {
                    this.addErrorMessage(`Could not focus ref with id ${refOp.refid}: elem is null`);
                    continue;
                }
                try {
                    elem.focus();
                } catch (e) {
                    this.addErrorMessage(`Could not focus ref with id ${refOp.refid}: ${e.message}`);
                }
            } else {
                this.addErrorMessage(`Unknown ref operation ${refOp.refid} ${refOp.op}`);
            }
        }
    }

    updateFavicon(faviconPath: string | null) {
        if (faviconPath === this.cachedFaviconPath) {
            return;
        }

        this.cachedFaviconPath = faviconPath;

        let existingFavicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;

        if (faviconPath) {
            if (existingFavicon) {
                existingFavicon.href = faviconPath;
            } else {
                const link = document.createElement("link");
                link.rel = "icon";
                link.href = faviconPath;
                document.head.appendChild(link);
            }
        } else {
            if (existingFavicon) {
                existingFavicon.remove();
            }
        }
    }

    handleBackendUpdate(update: VDomBackendUpdate) {
        if (update == null) {
            return;
        }

        // Check if serverId is changing and reset if needed
        if (this.serverId != null && this.serverId !== update.serverid) {
            // Server ID changed - reset the model state
            this.reset();
            this.setupServerEventSource();
        }

        this.serverId = update.serverid;
        getDefaultStore().set(this.contextActive, true);
        const idMap = new Map<string, VDomElem>();
        const vdomRoot = getDefaultStore().get(this.vdomRoot);
        if (update.opts != null) {
            this.backendOpts = update.opts;
            if (update.opts.title && update.opts.title.trim() !== "") {
                document.title = update.opts.title;
            }
            if (update.opts.faviconpath !== undefined) {
                this.updateFavicon(update.opts.faviconpath);
            }
            this.logTsunamiMeta(update.opts);
        }
        makeVDomIdMap(vdomRoot, idMap);
        this.handleRenderUpdates(update, idMap);
        this.handleRefOperations(update, idMap);
        if (update.messages) {
            for (let message of update.messages) {
                console.log("vdom-message", message.messagetype, message.message);
                if (message.stacktrace) {
                    console.log("vdom-message-stacktrace", message.stacktrace);
                }
            }
        }
        getDefaultStore().set(this.globalVersion, getDefaultStore().get(this.globalVersion) + 1);
        if (update.haswork) {
            this.hasBackendWork = true;
        }
    }

    renderDone(version: number) {
        // called when the render is done
        dlog("renderDone", version);
        let reasons: string[] = [];
        let needsQueue = false;
        if (this.hasRefUpdates()) {
            reasons.push("refupdates");
            needsQueue = true;
        }
        if (this.hasBackendWork) {
            reasons.push("backendwork");
            needsQueue = true;
            this.hasBackendWork = false;
        }
        if (needsQueue) {
            this.queueUpdate(true, reasons.join(","));
        }
    }

    callVDomFunc(fnDecl: VDomFunc, e: React.SyntheticEvent, compId: string, propName: string) {
        const vdomEvent: VDomEvent = {
            waveid: compId,
            eventtype: propName,
        };
        if (fnDecl.globalevent) {
            vdomEvent.globaleventtype = fnDecl.globalevent;
        }
        annotateEvent(vdomEvent, propName, e);
        this.batchedEvents.push(vdomEvent);
        this.queueUpdate(true, "event");
    }

    createFeUpdate(): VDomFrontendUpdate {
        const isFocused = document.hasFocus();
        const renderContext: VDomRenderContext = {
            focused: isFocused,
            width: this.viewRef?.current?.offsetWidth ?? 0,
            height: this.viewRef?.current?.offsetHeight ?? 0,
            rootrefid: this.rootRefId,
            background: false,
        };
        const feUpdate: VDomFrontendUpdate = {
            type: "frontendupdate",
            ts: Date.now(),
            clientid: this.clientId,
            rendercontext: renderContext,
            dispose: this.shouldDispose,
            resync: this.needsResync,
            events: this.batchedEvents,
            refupdates: this.getRefUpdates(),
            reason: this.reason,
        };
        this.needsResync = false;
        this.batchedEvents = [];
        this.reason = null;
        if (this.shouldDispose) {
            this.disposed = true;
        }
        return feUpdate;
    }
}
