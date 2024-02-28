// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { boundInt } from "./util";
import { MagicLayout } from "@/app/magiclayout";

const MinTermCols = 10;
const MaxTermCols = 1024;

let MonoFontSizes: MonoFontSize[] = [];

// MonoFontSizes[8] = {height: 11, width: 4.797};
// MonoFontSizes[9] = {height: 12, width: 5.398};
// MonoFontSizes[10] = {height: 13, width: 6};
// MonoFontSizes[11] = {height: 15, width: 6.602};
// MonoFontSizes[12] = {height: 16, width: 7.203};
// MonoFontSizes[13] = {height: 18, width: 7.797};
// MonoFontSizes[14] = {height: 19, width: 8.398};
// MonoFontSizes[15] = {height: 20, width: 9};
// MonoFontSizes[16] = {height: 22, width: 9.594};

function getMonoFontSize(fontSize: number): MonoFontSize {
    if (MonoFontSizes[fontSize] != null) {
        return MonoFontSizes[fontSize];
    }
    let size = measureText("W", { pre: true, mono: true, fontSize: fontSize });
    if (size.height != 0 && size.width != 0) {
        MonoFontSizes[fontSize] = size;
    }
    return size;
}

function clearMonoFontCache(): void {
    MonoFontSizes = [];
}

function measureText(text: string, textOpts: { pre?: boolean; mono?: boolean; fontSize: number }): MonoFontSize {
    if (textOpts == null) {
        throw new Error("invalid textOpts passed to measureText (null)");
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
    let height = Math.ceil(textElem.offsetHeight);
    let width = textElem.offsetWidth;
    let pad = Math.floor(height / 2);
    return { width, height, pad, fontSize: textOpts.fontSize };
}

function windowWidthToCols(width: number, fontSize: number): number {
    let dr = getMonoFontSize(fontSize);
    let cols = Math.trunc((width - MagicLayout.ScreenMaxContentWidthBuffer) / dr.width) - 1;
    cols = boundInt(cols, MinTermCols, MaxTermCols);
    return cols;
}

function windowHeightToRows(height: number, fontSize: number): number {
    let dr = getMonoFontSize(fontSize);
    let rows = Math.floor((height - MagicLayout.ScreenMaxContentHeightBuffer) / dr.height) - 1;
    if (rows <= 0) {
        rows = 1;
    }
    return rows;
}

function termWidthFromCols(cols: number, fontSize: number): number {
    let dr = getMonoFontSize(fontSize);
    return Math.ceil(dr.width * cols) + MagicLayout.TermWidthBuffer;
}

// we need to match the xtermjs calculation in CharSizeService.ts and DomRenderer.ts
// it does some crazy rounding depending on the value of window.devicePixelRatio
// works out to `realHeight = round(ceil(height * dpr) * rows / dpr) / rows`
// their calculation is based off the "totalRows" (so that argument has been added)
function termHeightFromRows(rows: number, fontSize: number, totalRows: number): number {
    let dr = getMonoFontSize(fontSize);
    const dpr = window.devicePixelRatio;
    if (totalRows == null || totalRows == 0) {
        totalRows = rows > 25 ? rows : 25;
    }
    let realHeight = Math.round((Math.ceil(dr.height * dpr) * totalRows) / dpr) / totalRows;
    return Math.ceil(realHeight * rows);
}

export {
    measureText,
    getMonoFontSize,
    windowWidthToCols,
    windowHeightToRows,
    termWidthFromCols,
    termHeightFromRows,
    clearMonoFontCache,
    MonoFontSizes,
};
