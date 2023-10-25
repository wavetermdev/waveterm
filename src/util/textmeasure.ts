// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { boundInt } from "./util";

const MinTermCols = 10;
const MaxTermCols = 1024;

let MonoFontSizes: { height: number; width: number }[] = [];

// MonoFontSizes[8] = {height: 11, width: 4.797};
// MonoFontSizes[9] = {height: 12, width: 5.398};
// MonoFontSizes[10] = {height: 13, width: 6};
// MonoFontSizes[11] = {height: 15, width: 6.602};
// MonoFontSizes[12] = {height: 16, width: 7.203};
// MonoFontSizes[13] = {height: 18, width: 7.797};
// MonoFontSizes[14] = {height: 19, width: 8.398};
// MonoFontSizes[15] = {height: 20, width: 9};
// MonoFontSizes[16] = {height: 22, width: 9.594};

function getMonoFontSize(fontSize: number): { height: number; width: number } {
    if (MonoFontSizes[fontSize] != null) {
        return MonoFontSizes[fontSize];
    }
    let size = measureText("W", { pre: true, mono: true, fontSize: fontSize });
    if (size.height != 0 && size.width != 0) {
        MonoFontSizes[fontSize] = size;
    }
    return size;
}

function measureText(
    text: string,
    textOpts?: { pre?: boolean; mono?: boolean; fontSize?: number | string }
): { height: number; width: number } {
    if (textOpts == null) {
        textOpts = {};
    }
    let textElem = document.createElement("span");
    if (textOpts.pre) {
        textElem.classList.add("pre");
    }
    if (textOpts.mono) {
        textElem.classList.add("mono");
    }
    if (textOpts.fontSize != null) {
        if (typeof textOpts.fontSize == "number") {
            textElem.style.fontSize = textOpts.fontSize + "px";
        } else {
            textElem.style.fontSize = textOpts.fontSize;
        }
    }
    textElem.innerText = text;
    let measureDiv = document.getElementById("measure");
    if (measureDiv == null) {
        throw new Error("cannot measure text, no #measure div");
    }
    measureDiv.replaceChildren(textElem);
    let rect = textElem.getBoundingClientRect();
    return { width: rect.width, height: Math.ceil(rect.height) };
}

function windowWidthToCols(width: number, fontSize: number): number {
    let dr = getMonoFontSize(fontSize);
    let cols = Math.trunc((width - 50) / dr.width) - 1;
    cols = boundInt(cols, MinTermCols, MaxTermCols);
    return cols;
}

function windowHeightToRows(height: number, fontSize: number): number {
    let dr = getMonoFontSize(fontSize);
    let rows = Math.floor((height - 80) / dr.height) - 1;
    if (rows <= 0) {
        rows = 1;
    }
    return rows;
}

function termWidthFromCols(cols: number, fontSize: number): number {
    let dr = getMonoFontSize(fontSize);
    return Math.ceil(dr.width * cols) + 15;
}

function termHeightFromRows(rows: number, fontSize: number): number {
    let dr = getMonoFontSize(fontSize);
    // TODO: replace the +3 with some calculation based on termFontSize.  the +3 is for descenders, which get cut off without this.
    return Math.ceil(dr.height * rows) + 3;
}

export { measureText, getMonoFontSize, windowWidthToCols, windowHeightToRows, termWidthFromCols, termHeightFromRows };
