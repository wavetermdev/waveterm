// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import "channels.less";

const channels = [
    {
        text: "Channel 1",
        icon: <i className="fa-sharp fa-solid fa-door-open"></i>,
        onClick: () => console.log("Inbox clicked"),
    },
    {
        text: "Channel 2",
        icon: <i className="fa-sharp fa-solid fa-paper-plane"></i>,
        onClick: () => console.log("Sent Mail clicked"),
    },
    {
        text: "Drafts",
        icon: <i className="fa-sharp fa-solid fa-drafting-compass"></i>,
        onClick: () => console.log("Drafts clicked"),
    },
];
