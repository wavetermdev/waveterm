// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { CollapsibleMenu } from "@/app/element/collapsiblemenu";
import "./channels.less";

const Channels = ({ channels }: { channels: MenuItem[] }) => {
    return <CollapsibleMenu className="channel-list" items={channels}></CollapsibleMenu>;
};

export { Channels };
