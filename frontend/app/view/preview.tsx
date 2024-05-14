// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";

import "./view.less";

const PreviewView = ({ blockId }: { blockId: string }) => {
    return (
        <div className="view-preview">
            <div>Preview</div>
        </div>
    );
};

export { PreviewView };
