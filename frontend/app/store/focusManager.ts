import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { atoms, getBlockComponentModel } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { getLayoutModelForStaticTab, getLayoutModelForTabById } from "@/layout/index";
import { Atom, atom, type PrimitiveAtom } from "jotai";

type FocusStrType = "node" | "waveai";

class FocusManager {
    focusType: PrimitiveAtom<FocusStrType> = atom("node");
    blockFocusAtom: Atom<string | null>;

    constructor() {
        this.blockFocusAtom = atom((get) => {
            if (get(this.focusType) == "waveai") {
                return null;
            }
            const tabId = globalStore.get(atoms.staticTabId);
            const layoutModel = getLayoutModelForTabById(tabId);
            const lnode = get(layoutModel.focusedNode);
            return lnode?.data?.blockId;
        });
    }

    setWaveAIFocused(force: boolean = false) {
        const isAlreadyFocused = globalStore.get(this.focusType) == "waveai";
        if (!force && isAlreadyFocused) {
            return;
        }
        globalStore.set(this.focusType, "waveai");
        this.refocusNode();
    }

    setBlockFocus(force: boolean = false) {
        const ftype = globalStore.get(this.focusType);
        if (!force && ftype == "node") {
            return;
        }
        globalStore.set(this.focusType, "node");
        this.refocusNode();
    }

    // pass null to refocus the currently focused block
    refocusNode() {
        const ftype = globalStore.get(this.focusType);
        if (ftype == "waveai") {
            WaveAIModel.getInstance().focusInput();
        }
        const layoutModel = getLayoutModelForStaticTab();
        const lnode = globalStore.get(layoutModel.focusedNode);
        if (lnode == null || lnode.data?.blockId == null) {
            return;
        }
        layoutModel.focusNode(lnode.id);
        const blockId = lnode.data.blockId;
        const bcm = getBlockComponentModel(blockId);
        const ok = bcm?.viewModel?.giveFocus?.();
        if (!ok) {
            const inputElem = document.getElementById(`${blockId}-dummy-focus`);
            inputElem?.focus();
        }
    }
}

export const focusManager = new FocusManager();
