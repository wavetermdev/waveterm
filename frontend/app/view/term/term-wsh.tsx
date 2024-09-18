// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WshClient } from "@/app/store/wshclient";
import { makeFeBlockRouteId } from "@/app/store/wshrouter";

export class TermWshClient extends WshClient {
    blockId: string;

    constructor(blockId: string) {
        super(makeFeBlockRouteId(blockId));
        this.blockId = blockId;
    }
}
