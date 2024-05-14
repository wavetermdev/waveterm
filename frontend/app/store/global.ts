// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as jotai from "jotai";
import { atomFamily } from "jotai/utils";
import { v4 as uuidv4 } from "uuid";
import * as rxjs from "rxjs";
import type { WailsEvent } from "@wailsio/runtime/types/events";
import { Events } from "@wailsio/runtime";

const globalStore = jotai.createStore();

const tabId1 = uuidv4();
const tabId2 = uuidv4();

const blockId1 = uuidv4();
const blockId2 = uuidv4();
const blockId3 = uuidv4();

const tabArr: TabData[] = [
    { name: "Tab 1", tabid: tabId1, blockIds: [blockId1, blockId2] },
    { name: "Tab 2", tabid: tabId2, blockIds: [blockId3] },
];

const blockAtomFamily = atomFamily<string, jotai.Atom<BlockData>>((blockId: string) => {
    if (blockId === blockId1) {
        return jotai.atom({ blockid: blockId1, view: "term" });
    }
    if (blockId === blockId2) {
        return jotai.atom({
            blockid: blockId2,
            view: "preview",
            meta: { mimetype: "text/markdown", file: "README.md" },
        });
    }
    if (blockId === blockId3) {
        return jotai.atom({ blockid: blockId3, view: "term" });
    }
    return jotai.atom(null);
});

const atoms = {
    activeTabId: jotai.atom<string>(tabId1),
    tabsAtom: jotai.atom<TabData[]>(tabArr),
    blockAtomFamily,
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

export { globalStore, atoms, getBlockSubject };
