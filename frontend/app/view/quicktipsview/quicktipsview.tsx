// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { QuickTips } from "@/app/element/quicktips";
import { globalStore } from "@/app/store/global";
import { Atom, atom, PrimitiveAtom } from "jotai";
import "./quicktipsview.less";

class QuickTipsViewModel implements ViewModel {
    viewType: string;
    showTocAtom: PrimitiveAtom<boolean>;
    endIconButtons: Atom<IconButtonDecl[]>;

    constructor() {
        this.viewType = "tips";
        this.showTocAtom = atom(false);
    }

    showTocToggle() {
        globalStore.set(this.showTocAtom, !globalStore.get(this.showTocAtom));
    }
}

function makeQuickTipsViewModel() {
    return new QuickTipsViewModel();
}

function QuickTipsView({ model }: { model: QuickTipsViewModel }) {
    return (
        <div className="quicktips-view">
            <QuickTips />
        </div>
    );
}

export { makeQuickTipsViewModel, QuickTipsView, QuickTipsViewModel };
