// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// magical layout constants to power TypeScript calculations
// these need to match the CSS (usually margins, paddings, positions, etc.)
let MagicLayout = {
    ScreenMaxContentWidthBuffer: 50,
    ScreenMinContentSize: 100,
    ScreenMaxContentSize: 5000,

    TermWidthBuffer: 15,

    TabWidth: 155,

    ScreenSidebarWidthPadding: 5,
    ScreenSidebarMinWidth: 200,
    ScreenSidebarHeaderHeight: 26,

    MainSidebarMinWidth: 0,
    MainSidebarMaxWidth: 300,
    MainSidebarSnapThreshold: 165,
    MainSidebarDragResistance: 50,
    MainSidebarDefaultWidth: 240,

    RightSidebarMinWidth: 0,
    RightSidebarMaxWidth: 700,
    RightSidebarSnapThreshold: 90,
    RightSidebarDragResistance: 50,
    RightSidebarDefaultWidth: 240,
};

let m = MagicLayout;

(window as any).MagicLayout = MagicLayout;

export { MagicLayout };
