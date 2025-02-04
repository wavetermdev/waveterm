// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WOS } from "@/store/global";
import { ObjectService } from "@/store/services";
import { fireAndForget } from "@/util/util";
import { atom, Atom, useAtomValue } from "jotai";
import React from "react";

// View Model
export class ShapesViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    blockAtom: Atom<Block>;
    viewIcon: Atom<string>;
    viewName: Atom<string>;
    endIconButtons: Atom<IconButtonDecl[]>;

    constructor(blockId: string) {
        this.viewType = "shapes";
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = atom("shapes");
        this.viewName = atom("Shapes");

        // Add shape toggle buttons to header
        this.endIconButtons = atom((get) => {
            const currentShape = get(this.blockAtom).meta["shape"] ?? "circle";
            return [
                {
                    elemtype: "iconbutton",
                    icon: "circle",
                    title: "Switch to Circle",
                    click: () => this.setShape("circle"),
                    className: currentShape === "circle" ? "active" : "",
                },
                {
                    elemtype: "iconbutton",
                    icon: "square",
                    title: "Switch to Square",
                    click: () => this.setShape("square"),
                    className: currentShape === "square" ? "active" : "",
                },
            ];
        });
    }

    setShape(shape: "circle" | "square") {
        fireAndForget(() =>
            ObjectService.UpdateObjectMeta(WOS.makeORef("block", this.blockId), {
                shape,
            })
        );
    }

    dispose() {
        // No cleanup needed for this simple widget
    }
}

// React Component
interface ShapesProps {
    blockId: string;
    model: ShapesViewModel;
}

export const Shapes: React.FC<ShapesProps> = ({ model }) => {
    const block = useAtomValue(model.blockAtom);
    const currentShape = block.meta["shape"] ?? "circle";

    const containerStyle = {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "24rem",
        width: "100%",
    };

    const shapeStyle = {
        width: "8rem",
        height: "8rem",
        backgroundColor: "#3b82f6",
        borderRadius: currentShape === "circle" ? "50%" : "0",
    };

    return (
        <div style={containerStyle}>
            <div style={shapeStyle} />
        </div>
    );
};

// Factory function
export function makeShapesViewModel(blockId: string): ShapesViewModel {
    return new ShapesViewModel(blockId);
}
