// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore, WOS } from "@/app/store/global";
import { ObjectService } from "@/app/store/services";
import { makeORef } from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { WindowRpcClient } from "@/app/store/wshrpcutil";
import { TermWshClient } from "@/app/view/term/term-wsh";
import { NodeModel } from "@/layout/index";
import { adaptFromReactOrNativeKeyEvent } from "@/util/keyutil";
import * as jotai from "jotai";

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

function updateTrackedPosition(container: RefContainer) {
    // TODO
}

function convertEvent(e: React.SyntheticEvent, fromProp: string): any {
    if (e == null) {
        return null;
    }
    if (fromProp == "onClick") {
        return { type: "click" };
    }
    if (fromProp == "onKeyDown") {
        const waveKeyEvent = adaptFromReactOrNativeKeyEvent(e as React.KeyboardEvent);
        return waveKeyEvent;
    }
    if (fromProp == "onFocus") {
        return { type: "focus" };
    }
    if (fromProp == "onBlur") {
        return { type: "blur" };
    }
    return { type: "unknown" };
}

export class VDomModel {
    blockId: string;
    nodeModel: NodeModel;
    viewRef: React.RefObject<HTMLDivElement>;
    vdomRoot: jotai.PrimitiveAtom<VDomElem> = jotai.atom();
    atoms: Map<string, AtomContainer> = new Map(); // key is atomname
    refs: Map<string, RefContainer> = new Map(); // key is refid
    batchedEvents: VDomEvent[] = [];
    refUpdates: VDomRefUpdate[] = [];
    messages: VDomMessage[] = [];
    needsResync: boolean = true;
    vdomNodeVersion: WeakMap<VDomElem, jotai.PrimitiveAtom<number>> = new WeakMap();
    compoundAtoms: Map<string, jotai.PrimitiveAtom<{ [key: string]: any }>> = new Map();
    rootRefId: string = crypto.randomUUID();
    hasPendingRequest: boolean = false;
    pendingTimeoutId: any;
    termWshClient: TermWshClient;
    backendRoute: string;
    needsUpdate: boolean = false;
    updateMs: number = 100;
    nextUpdateQuick: boolean = false;

    constructor(
        blockId: string,
        nodeModel: NodeModel,
        viewRef: React.RefObject<HTMLDivElement>,
        termWshClient: TermWshClient
    ) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.viewRef = viewRef;
        this.termWshClient = termWshClient;
    }

    reset() {
        globalStore.set(this.vdomRoot, null);
        this.atoms.clear();
        this.refs.clear();
        this.batchedEvents = [];
        this.refUpdates = [];
        this.messages = [];
        this.needsResync = true;
        this.vdomNodeVersion = new WeakMap();
        this.compoundAtoms.clear();
        this.rootRefId = crypto.randomUUID();
        this.hasPendingRequest = false;
        this.needsUpdate = false;
        this.nextUpdateQuick = false;
    }

    queueUpdate() {
        if (this.pendingTimeoutId) {
            clearTimeout(this.pendingTimeoutId);
        }
        let updateMs = this.nextUpdateQuick ? 0 : this.updateMs;
        this.nextUpdateQuick = false;
        this.pendingTimeoutId = setTimeout(() => {
            this.sendRenderRequest(false);
        }, updateMs);
    }

    async sendRenderRequest(force: boolean) {
        if (this.pendingTimeoutId) {
            clearTimeout(this.pendingTimeoutId);
        }
        if (this.hasPendingRequest) {
            if (force) {
                this.nextUpdateQuick = true;
            }
            return;
        }
        if (!force && !this.needsUpdate) {
            this.queueUpdate();
            return;
        }
        if (this.backendRoute == null) {
            console.log("vdom-model", "no backend route");
            return;
        }
        this.hasPendingRequest = true;
        try {
            const feUpdate = this.createFeUpdate();
            const beUpdate = await RpcApi.VDomRenderCommand(WindowRpcClient, feUpdate, { route: this.backendRoute });
            this.handleBackendUpdate(beUpdate);
        } finally {
            this.hasPendingRequest = false;
        }
        this.queueUpdate();
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
                    if (vdomRef.trackposition) {
                        updateTrackedPosition(container);
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
        const idMap = new Map<string, VDomElem>();
        const vdomRoot = globalStore.get(this.vdomRoot);
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
    }

    callVDomFunc(e: any, compId: string, propName: string) {
        const eventData = convertEvent(e, propName);
        const vdomEvent: VDomEvent = {
            waveid: compId,
            eventtype: propName,
            eventdata: eventData,
        };
        this.batchedEvents.push(vdomEvent);
    }

    createFeUpdate(): VDomFrontendUpdate {
        const blockORef = makeORef("block", this.blockId);
        const blockAtom = WOS.getWaveObjectAtom<Block>(blockORef);
        const blockData = globalStore.get(blockAtom);
        const needsInitialize = !blockData?.meta?.["vdom:initialized"];
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
            requestid: crypto.randomUUID(),
            initialize: needsInitialize,
            rendercontext: renderContext,
            resync: this.needsResync,
            events: this.batchedEvents,
            refupdates: this.refUpdates,
        };
        this.needsResync = false;
        if (needsInitialize) {
            ObjectService.UpdateObjectMeta(blockORef, { "vdom:initialized": true });
        }
        this.batchedEvents = [];
        this.refUpdates = [];
        return feUpdate;
    }
}
