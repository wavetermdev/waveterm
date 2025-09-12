// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { WOS } from "@/app/store/global";
import * as jotai from "jotai";
import { memo } from "react";

class TsunamiViewModel implements ViewModel {
    viewType: string;
    blockAtom: jotai.Atom<Block>;
    blockId: string;
    viewIcon: jotai.Atom<string>;
    viewName: jotai.Atom<string>;

    constructor(blockId: string, nodeModel: BlockNodeModel) {
        this.viewType = "tsunami";
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = jotai.atom("cube");
        this.viewName = jotai.atom("Tsunami");
    }

    get viewComponent(): ViewComponent {
        return TsunamiView;
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        return [];
    }
}

type TsunamiViewProps = {
    model: TsunamiViewModel;
};

const TsunamiView = memo(({ model }: TsunamiViewProps) => {
    return (
        <div className="w-full h-full flex items-center justify-center">
            <h1 className="text-4xl font-bold text-main-text-color">Tsunami</h1>
        </div>
    );
});

TsunamiView.displayName = "TsunamiView";

export { TsunamiViewModel };