// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function makeTermLinkHandlers(
    isMacOS: boolean,
    openUri: (uri: string) => void,
    onHover: (uri: string | null, x: number, y: number, showUrl: boolean) => void
) {
    return {
        activate: (event: MouseEvent, uri: string) => {
            event.preventDefault();
            if (!(isMacOS ? event.metaKey : event.ctrlKey)) {
                return;
            }
            openUri(uri);
        },
        hover: (event: MouseEvent, uri: string) => onHover(uri, event.clientX, event.clientY, false),
        osc8Hover: (event: MouseEvent, uri: string) => onHover(uri, event.clientX, event.clientY, true),
        leave: () => onHover(null, 0, 0, false),
    };
}
