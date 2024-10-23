// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { VDomRoot } from "@/app/view/term/vdom";
import { VDomModel } from "@/app/view/term/vdom-model";
import { NodeModel } from "@/layout/index";
import { useRef } from "react";

function makeVDomModel(blockId: string, nodeModel: NodeModel): VDomModel {
    return new VDomModel(blockId, nodeModel);
}

type VDomViewProps = {
    model: VDomModel;
    blockId: string;
};

function VDomView({ blockId, model }: VDomViewProps) {
    let viewRef = useRef(null);
    model.viewRef = viewRef;
    return (
        <div className="vdom-view" ref={viewRef}>
            <VDomRoot model={model} />
        </div>
    );
}

export { makeVDomModel, VDomView };
