// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { FC, useState, useEffect } from "react";
import { LineStateType, RendererModelContainerApi } from "../../types/types";
import { GlobalModel } from "../../model/model";

interface DebugProps {
    shouldFocus: boolean;
    lineState: LineStateType;
    rendererApi: RendererModelContainerApi;
}

interface State {
    content: string | null;
}

const DebugRenderer: FC<DebugProps> = (props: DebugProps) => {
    const { rendererApi, shouldFocus, lineState } = props;

    useEffect(() => {
        if (shouldFocus) {
            rendererApi.onFocusChanged(true);
        }
    }, [shouldFocus, rendererApi]);

    return (
        <div className="debug-renderer" style={{ fontSize: GlobalModel.termFontSize.get() }}>
            <pre>test</pre>
        </div>
    );
};

export { DebugRenderer };
