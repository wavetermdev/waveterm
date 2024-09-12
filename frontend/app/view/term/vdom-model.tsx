// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/global";
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
    vdomRoot: jotai.PrimitiveAtom<VDomElem> = jotai.atom();
    atoms: Map<string, AtomContainer> = new Map(); // key is atomname
    refs: Map<string, RefContainer> = new Map(); // key is refid
    batchedEvents: VDomEvent[] = [];
    refUpdates: VDomRefUpdate[] = [];
    messages: VDomMessage[] = [];
    initialized: boolean = false;
    vdomNodeVersion: WeakMap<VDomElem, jotai.PrimitiveAtom<number>> = new WeakMap();
    compoundAtoms: Map<string, jotai.PrimitiveAtom<{ [key: string]: any }>> = new Map();

    constructor(blockId: string) {
        this.blockId = blockId;
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

    handleRefOperations(update: VDomBackendUpdate, idMap: Map<string, VDomElem>) {
        if (update.refoperations == null) {
            return;
        }
        for (let refOp of update.refoperations) {
            const ref = this.refs.get(refOp.refid);
            if (ref == null) {
                this.addErrorMessage(`Could not find ref with id ${refOp.refid}`);
                continue;
            }
            if (refOp.op == "focus") {
                if (ref.elem == null) {
                    this.addErrorMessage(`Could not focus ref with id ${refOp.refid}: elem is null`);
                    continue;
                }
                try {
                    ref.elem.focus();
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

    updateRefFunc(elem: any, ref: VDomRef) {}
}
