// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type AnchorItem = { href: string; top: number };

// 뷰포트 상단(0 기준 상대좌표)에 걸쳐 있거나 바로 위에 있는 마지막 heading을 고른다.
function pickCurrentAnchor(items: AnchorItem[], viewportTop: number): string | null {
    if (items == null || items.length == 0) {
        return null;
    }
    const threshold = viewportTop + 4;
    let current: string | null = null;
    for (const item of items) {
        if (item.top <= threshold) {
            current = item.href;
        }
    }
    return current ?? items[0].href;
}

export { pickCurrentAnchor };
export type { AnchorItem };
