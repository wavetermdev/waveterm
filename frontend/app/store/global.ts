// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as jotai from "jotai";
import { atomFamily } from "jotai/utils";
import { v4 as uuidv4 } from "uuid";

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
        return jotai.atom({ blockid: blockId2, view: "preview", meta: { mimetype: "text/markdown" } });
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

export { globalStore, atoms };
