// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CollapsibleMenu } from "@/app/element/collapsiblemenu";
import { memo } from "react";

import "./channels.less";

const Channels = memo(({ channels }: { channels: MenuItem[] }) => {
    return <CollapsibleMenu className="channel-list" items={channels}></CollapsibleMenu>;
});

export { Channels };
