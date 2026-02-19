// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const Counters = new Map<string, number>();

function countersClear() {
    Counters.clear();
}

function counterInc(name: string, incAmt: number = 1) {
    let count = Counters.get(name) ?? 0;
    count += incAmt;
    Counters.set(name, count);
}

function countersPrint() {
    let outStr = "";
    for (const [name, count] of Counters.entries()) {
        outStr += `${name}: ${count}\n`;
    }
    console.log(outStr);
}

export { counterInc, countersClear, countersPrint };
