// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import type { TabModel } from "@/app/store/tab-model";
import { getBlockMetaKeyAtom, globalStore, WOS } from "@/app/store/global";
import { makeORef } from "@/app/store/wos";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcResponseHelper, WshClient } from "@/app/store/wshclient";
import { RpcApi } from "@/app/store/wshclientapi";
import { makeFeBlockRouteId } from "@/app/store/wshrouter";
import { DefaultRouter, TabRpcClient } from "@/app/store/wshrpcutil";
import { VDomView } from "@/app/view/vdom/vdom";
import { applyCanvasOp, mergeBackendUpdates, restoreVDomElems } from "@/app/view/vdom/vdom-utils";
import { getWebServerEndpoint } from "@/util/endpoints";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import debug from "debug";
import * as jotai from "jotai";

const dlog = debug("wave:vdom");

type AtomContainer = {
    val: any;
    beVal: any;
    usedBy: Set<string>;
};

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

class VDomWshClient extends WshClient {
    model: VDomModel;

    constructor(model: VDomModel) {
        super(makeFeBlockRouteId(model.blockId));
        this.model = model;
    }

    handle_vdomasyncinitiation(rh: RpcResponseHelper, data: VDomAsyncInitiationRequest) {
        dlog("async-initiation", rh.getSource(), data);
        this.model.queueUpdate(true);
    }
}

export class VDomModel {
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewType: string;
    viewIcon: jotai.Atom<string>;
    viewName: jotai.Atom<string>;
    viewRef: React.RefObject<HTMLDivElement> = { current: null };
    vdomRoot: jotai.PrimitiveAtom<VDomElem> = jotai.atom();
    atoms: Map<string, AtomContainer> = new Map(); // key is atomname
    refs: Map<string, RefContainer> = new Map(); // key is refid
    batchedEvents: VDomEvent[] = [];
    messages: VDomMessage[] = [];
    needsResync: boolean = true;
    vdomNodeVersion: WeakMap<VDomElem, jotai.PrimitiveAtom<number>> = new WeakMap();
    compoundAtoms: Map<string, jotai.PrimitiveAtom<{ [key: string]: any }>> = new Map();
    rootRefId: string = crypto.randomUUID();
    backendRoute: jotai.Atom<string>;
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
    wshClient: VDomWshClient;
    persist: jotai.Atom<boolean>;
    routeGoneUnsub: () => void;
    routeConfirmed: boolean = false;
    refOutputStore: Map<string, any> = new Map();
    globalVersion: jotai.PrimitiveAtom<number> = jotai.atom(0);
    hasBackendWork: boolean = false;
    noPadding: jotai.PrimitiveAtom<boolean>;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.viewType = "vdom";
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.contextActive = jotai.atom(false);
        this.reset();
        this.viewIcon = jotai.atom("bolt");
        this.viewName = jotai.atom("Wave App");
        this.backendRoute = jotai.atom((get) => {
            const blockData = get(WOS.getWaveObjectAtom<Block>(makeORef("block", this.blockId)));
            return blockData?.meta?.["vdom:route"];
        });
        this.noPadding = jotai.atom(true);
        this.persist = getBlockMetaKeyAtom(this.blockId, "vdom:persist");
        this.wshClient = new VDomWshClient(this);
        DefaultRouter.registerRoute(this.wshClient.routeId, this.wshClient);
        const curBackendRoute = globalStore.get(this.backendRoute);
        if (curBackendRoute) {
            this.queueUpdate(true);
        }
        this.routeGoneUnsub = waveEventSubscribeSingle({
            eventType: "route:down",
            scope: curBackendRoute,
            handler: (_event) => {
                this.disposed = true;
                const shouldPersist = globalStore.get(this.persist);
                if (!shouldPersist) {
                    this.nodeModel?.onClose?.();
                }
            },
        });
        RpcApi.WaitForRouteCommand(TabRpcClient, { routeid: curBackendRoute, waitms: 4000 }, { timeout: 5000 }).then(
            (routeOk: boolean) => {
                if (routeOk) {
                    this.routeConfirmed = true;
                    this.queueUpdate(true);
                } else {
                    this.disposed = true;
                    const shouldPersist = globalStore.get(this.persist);
                    if (!shouldPersist) {
                        this.nodeModel?.onClose?.();
                    }
                }
            }
        );
    }

    get viewComponent(): ViewComponent {
        return VDomView;
    }

    dispose() {
        DefaultRouter.unregisterRoute(this.wshClient.routeId);
        this.routeGoneUnsub?.();
    }

    reset() {
        globalStore.set(this.vdomRoot, null);
        this.atoms.clear();
        this.refs.clear();
        this.batchedEvents = [];
        this.messages = [];
        this.needsResync = true;
        this.vdomNodeVersion = new WeakMap();
        this.compoundAtoms.clear();
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
        globalStore.set(this.contextActive, false);
    }

    getBackendRoute(): string {
        const blockData = globalStore.get(WOS.getWaveObjectAtom<Block>(makeORef("block", this.blockId)));
        return blockData?.meta?.["vdom:route"];
    }

    transformVDomUrl(url: string): string {
        if (url == null || url == "") {
            return null;
        }
        if (!url.startsWith("vdom://")) {
            return url;
        }
        const absUrl = url.substring(7);
        return this.makeVDomUrl(absUrl);
    }

    makeVDomUrl(path: string): string {
        if (path == null || path == "") {
            return null;
        }
        if (!path.startsWith("/")) {
            return null;
        }
        const backendRouteId = this.getBackendRouteId();
        if (backendRouteId == null) {
            return null;
        }
        const wsEndpoint = getWebServerEndpoint();
        const fullUrl = wsEndpoint + "/vdom/" + backendRouteId + path;
        return fullUrl;
    }

    keyDownHandler(e: WaveKeyboardEvent): boolean {
        if (this.backendOpts?.closeonctrlc && checkKeyPressed(e, "Ctrl:c")) {
            this.shouldDispose = true;
            this.queueUpdate(true);
            return true;
        }
        if (this.backendOpts?.globalkeyboardevents) {
            if (e.cmd || e.meta) {
                return false;
            }
            this.batchedEvents.push({
                globaleventtype: "onKeyDown",
                waveid: null,
                eventtype: "onKeyDown",
                keydata: e,
            });
            this.queueUpdate();
            return true;
        }
        return false;
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

    queueUpdate(quick: boolean = false, delay: number = 10) {
        if (this.disposed) {
            return;
        }
        this.needsUpdate = true;
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
        if (this.disposed || !this.routeConfirmed) {
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
        const backendRoute = globalStore.get(this.backendRoute);
        if (backendRoute == null) {
            console.log("vdom-model", "no backend route");
            return;
        }
        this.hasPendingRequest = true;
        this.needsImmediateUpdate = false;
        try {
            const feUpdate = this.createFeUpdate();
            dlog("fe-update", feUpdate);
            const beUpdateGen = await RpcApi.VDomRenderCommand(TabRpcClient, feUpdate, { route: backendRoute });
            let baseUpdate: VDomBackendUpdate = null;
            for await (const beUpdate of beUpdateGen) {
                if (baseUpdate === null) {
                    baseUpdate = beUpdate;
                } else {
                    mergeBackendUpdates(baseUpdate, beUpdate);
                }
            }
            if (baseUpdate !== null) {
                restoreVDomElems(baseUpdate);
                dlog("be-update", baseUpdate);
                this.handleBackendUpdate(baseUpdate);
            }
            dlog("update cycle done");
        } finally {
            this.lastUpdateTs = Date.now();
            this.hasPendingRequest = false;
        }
        if (this.needsImmediateUpdate) {
            this.queueUpdate(true);
        }
    }

    getAtomContainer(atomName: string): AtomContainer {
        let container = this.atoms.get(atomName);
        if (container == null) {
            container = {
                val: null,
                beVal: null,
                usedBy: new Set(),
            };
            this.atoms.set(atomName, container);
        }
        return container;
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

    tagUseAtoms(waveId: string, atomNames: Set<string>) {
        for (let atomName of atomNames) {
            let container = this.getAtomContainer(atomName);
            container.usedBy.add(waveId);
        }
    }

    tagUnuseAtoms(waveId: string, atomNames: Set<string>) {
        for (let atomName of atomNames) {
            let container = this.getAtomContainer(atomName);
            container.usedBy.delete(waveId);
        }
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
        globalStore.set(atom, globalStore.get(atom) + 1);
    }

    addErrorMessage(message: string) {
        this.messages.push({
            messagetype: "error",
            message: message,
        });
    }

    handleRenderUpdates(update: VDomBackendUpdate, idMap: Map<string, VDomElem>) {
        if (!update.renderupdates) {
            return;
        }
        for (let renderUpdate of update.renderupdates) {
            if (renderUpdate.updatetype == "root") {
                globalStore.set(this.vdomRoot, renderUpdate.vdom);
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

    setAtomValue(atomName: string, value: any, fromBe: boolean, idMap: Map<string, VDomElem>) {
        dlog("setAtomValue", atomName, value, fromBe);
        let container = this.getAtomContainer(atomName);
        container.val = value;
        if (fromBe) {
            container.beVal = value;
        }
        for (let id of container.usedBy) {
            this.incVDomNodeVersion(idMap.get(id));
        }
    }

    handleStateSync(update: VDomBackendUpdate, idMap: Map<string, VDomElem>) {
        if (update.statesync == null) {
            return;
        }
        for (let sync of update.statesync) {
            this.setAtomValue(sync.atom, sync.value, true, idMap);
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

    handleBackendUpdate(update: VDomBackendUpdate) {
        if (update == null) {
            return;
        }
        globalStore.set(this.contextActive, true);
        const idMap = new Map<string, VDomElem>();
        const vdomRoot = globalStore.get(this.vdomRoot);
        if (update.opts != null) {
            this.backendOpts = update.opts;
        }
        makeVDomIdMap(vdomRoot, idMap);
        this.handleRenderUpdates(update, idMap);
        this.handleStateSync(update, idMap);
        this.handleRefOperations(update, idMap);
        if (update.messages) {
            for (let message of update.messages) {
                console.log("vdom-message", this.blockId, message.messagetype, message.message);
                if (message.stacktrace) {
                    console.log("vdom-message-stacktrace", message.stacktrace);
                }
            }
        }
        globalStore.set(this.globalVersion, globalStore.get(this.globalVersion) + 1);
        if (update.haswork) {
            this.hasBackendWork = true;
        }
    }

    renderDone(version: number) {
        // called when the render is done
        dlog("renderDone", version);
        if (this.hasRefUpdates() || this.hasBackendWork) {
            this.hasBackendWork = false;
            this.queueUpdate(true);
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
        this.queueUpdate(true);
    }

    createFeUpdate(): VDomFrontendUpdate {
        const blockORef = makeORef("block", this.blockId);
        const blockAtom = WOS.getWaveObjectAtom<Block>(blockORef);
        const blockData = globalStore.get(blockAtom);
        const isBlockFocused = globalStore.get(this.nodeModel.isFocused);
        const renderContext: VDomRenderContext = {
            blockid: this.blockId,
            focused: isBlockFocused,
            width: this.viewRef?.current?.offsetWidth ?? 0,
            height: this.viewRef?.current?.offsetHeight ?? 0,
            rootrefid: this.rootRefId,
            background: false,
        };
        const feUpdate: VDomFrontendUpdate = {
            type: "frontendupdate",
            ts: Date.now(),
            blockid: this.blockId,
            rendercontext: renderContext,
            dispose: this.shouldDispose,
            resync: this.needsResync,
            events: this.batchedEvents,
            refupdates: this.getRefUpdates(),
        };
        this.needsResync = false;
        this.batchedEvents = [];
        if (this.shouldDispose) {
            this.disposed = true;
        }
        return feUpdate;
    }

    getBackendRouteId(): string {
        const fullRoute = globalStore.get(this.backendRoute);
        if (fullRoute == null || !fullRoute.startsWith("proc:")) {
            return null;
        }
        return fullRoute?.split(":")[1];
    }
}
