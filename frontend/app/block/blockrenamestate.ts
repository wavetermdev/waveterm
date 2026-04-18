// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as jotai from "jotai";

export const renamingBlockIdAtom = jotai.atom<string | null>(null);

export function startBlockRename(blockId: string) {
    globalStore.set(renamingBlockIdAtom, blockId);
}

export function stopBlockRename() {
    globalStore.set(renamingBlockIdAtom, null);
}
