// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// magical layout constants to power TypeScript calculations
// these need to match the CSS (usually margins, paddings, positions, etc.)
let MagicLayout = {
    CmdInputHeight: 101, // height of full cmd-input div
    CmdInputBottom: 12, // .cmd-input

    LineHeaderHeight: 46, // .line-header
    LinePadding: 24, // .line-header (12px * 2)
    WindowHeightOffset: 6, // .window-view, height is calc(100%-0.5rem)
    LinesBottomPadding: 10, // .lines, padding
    LineMarginTop: 12, // .line, margin

    ScreenMaxContentWidthBuffer: 50,
    ScreenMaxContentHeightBuffer: 0, // calc below
    ScreenMinContentSize: 100,
    ScreenMaxContentSize: 5000,

    // the 3 is for descenders, which get cut off in the terminal without this
    TermDescendersHeight: 3,
    TermWidthBuffer: 15,

    TabWidth: 175,
};

let m = MagicLayout;

// add up all the line overhead + padding.  subtract 2 so we don't see the border of neighboring line
m.ScreenMaxContentHeightBuffer =
    m.LineHeaderHeight + m.LinePadding + m.WindowHeightOffset + m.LinesBottomPadding + m.LineMarginTop - 2;

(window as any).MagicLayout = MagicLayout;

export { MagicLayout };
