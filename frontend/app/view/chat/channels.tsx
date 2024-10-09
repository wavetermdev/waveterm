// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { Menu, MenuItem } from "@/app/element/menu";

import "./channels.less";

const Channels = ({ channels }: { channels: MenuItem[] }) => {
    return <Menu className="channel-list" items={channels}></Menu>;
};

export { Channels };
