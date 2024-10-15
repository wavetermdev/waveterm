// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { VerticalNav } from "@/app/element/verticalnav";
import "./channels.less";

const Channels = ({ channels }: { channels: MenuItem[] }) => {
    return <VerticalNav className="channel-list" items={channels}></VerticalNav>;
};

export { Channels };
