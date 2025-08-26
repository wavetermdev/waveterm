// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { QuickTips } from "@/app/element/quicktips";
import { globalStore } from "@/app/store/global";
import { Atom, atom, PrimitiveAtom } from "jotai";

class QuickTipsViewModel implements ViewModel {
    viewType: string;
    showTocAtom: PrimitiveAtom<boolean>;
    endIconButtons: Atom<IconButtonDecl[]>;

    constructor() {
        this.viewType = "tips";
        this.showTocAtom = atom(false);
    }

    get viewComponent(): ViewComponent {
        return QuickTipsView;
    }

    showTocToggle() {
        globalStore.set(this.showTocAtom, !globalStore.get(this.showTocAtom));
    }
}

function QuickTipsView({ model }: { model: QuickTipsViewModel }) {
    return (
        <div className="px-[5px] py-[10px] overflow-auto w-full">
            <QuickTips />
        </div>
    );
}

export { QuickTipsViewModel };
