// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as jotai from "jotai";
import { atomFamily } from "jotai/utils";
import { v4 as uuidv4 } from "uuid";
import * as rxjs from "rxjs";
import type { WailsEvent } from "@wailsio/runtime/types/events";
import { Events } from "@wailsio/runtime";
import { produce } from "immer";
import { BlockService } from "@/bindings/blockservice";

const globalStore = jotai.createStore();

const tabId1 = uuidv4();

const tabArr: TabData[] = [{ name: "Tab 1", tabid: tabId1, blockIds: [] }];
const blockDataMap = new Map<string, jotai.Atom<BlockData>>();
const blockAtomCache = new Map<string, Map<string, jotai.Atom<any>>>();

const atoms = {
    activeTabId: jotai.atom<string>(tabId1),
    tabsAtom: jotai.atom<TabData[]>(tabArr),
    blockDataMap: blockDataMap,
};

type SubjectWithRef<T> = rxjs.Subject<T> & { refCount: number; release: () => void };

const blockSubjects = new Map<string, SubjectWithRef<any>>();

function getBlockSubject(blockId: string): SubjectWithRef<any> {
    let subject = blockSubjects.get(blockId);
    if (subject == null) {
        subject = new rxjs.Subject<any>() as any;
        subject.refCount = 0;
        subject.release = () => {
            subject.refCount--;
            if (subject.refCount === 0) {
                subject.complete();
                blockSubjects.delete(blockId);
            }
        };
        blockSubjects.set(blockId, subject);
    }
    subject.refCount++;
    return subject;
}

Events.On("block:ptydata", (event: any) => {
    const data = event?.data;
    if (data?.blockid == null) {
        console.log("block:ptydata with null blockid");
        return;
    }
    // we don't use getBlockSubject here because we don't want to create a new subject
    const subject = blockSubjects.get(data.blockid);
    if (subject == null) {
        return;
    }
    subject.next(data);
});

function addBlockIdToTab(tabId: string, blockId: string) {
    let tabArr = globalStore.get(atoms.tabsAtom);
    const newTabArr = produce(tabArr, (draft) => {
        const tab = draft.find((tab) => tab.tabid == tabId);
        tab.blockIds.push(blockId);
    });
    globalStore.set(atoms.tabsAtom, newTabArr);
}

function removeBlock(blockId: string) {
    blockDataMap.delete(blockId);
    blockAtomCache.delete(blockId);
}

function useBlockAtom<T>(blockId: string, name: string, makeFn: () => jotai.Atom<T>): jotai.Atom<T> {
    let blockCache = blockAtomCache.get(blockId);
    if (blockCache == null) {
        blockCache = new Map<string, jotai.Atom<any>>();
        blockAtomCache.set(blockId, blockCache);
    }
    let atom = blockCache.get(name);
    if (atom == null) {
        atom = makeFn();
        blockCache.set(name, atom);
    }
    return atom as jotai.Atom<T>;
}

function removeBlockFromTab(tabId: string, blockId: string) {
    let tabArr = globalStore.get(atoms.tabsAtom);
    const newTabArr = produce(tabArr, (draft) => {
        const tab = draft.find((tab) => tab.tabid == tabId);
        tab.blockIds = tab.blockIds.filter((id) => id !== blockId);
    });
    globalStore.set(atoms.tabsAtom, newTabArr);
    removeBlock(blockId);
    BlockService.CloseBlock(blockId);
}

export { globalStore, atoms, getBlockSubject, addBlockIdToTab, blockDataMap, useBlockAtom, removeBlockFromTab };
