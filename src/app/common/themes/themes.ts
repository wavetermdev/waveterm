// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * The file contains barebones of styling to appy themes to Prompt.
 * @TODO: Find a way to change the theme system-wide. atm, we are captruing colors in main.less
 */

const themes = [
    {
        id: "default",
        terminal: { foreground: "#eceeec", background: "transparent" },
    },
];

const getTheme = (_id = "default") => themes.find(({ id }) => id === _id);

export { getTheme };
