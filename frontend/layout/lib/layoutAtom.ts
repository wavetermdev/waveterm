// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WOS } from "@/app/store/global";
import { Atom, Getter } from "jotai";

export function getLayoutStateAtomFromTab(tabAtom: Atom<Tab>, get: Getter): WritableWaveObjectAtom<LayoutState> {
    const tabData = get(tabAtom);
    if (!tabData) return;
    const layoutStateOref = WOS.makeORef("layout", tabData.layoutstate);
    const layoutStateAtom = WOS.getWaveObjectAtom<LayoutState>(layoutStateOref);
    return layoutStateAtom;
}
