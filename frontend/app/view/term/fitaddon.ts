/**
 * Copyright (c) 2017 The xterm.js authors. All rights reserved.
 * @license MIT
 */

// This file is a copy of the original xterm.js file, with the following changes:
// - Added noScrollbar flag to support macOS scrollbar behavior
// - Updated for xterm.js 6.1.0 public API

import type { FitAddon as IFitApi } from "@xterm/addon-fit";
import type { ITerminalAddon, Terminal, IRenderDimensions } from "@xterm/xterm";

interface ITerminalDimensions {
    /**
     * The number of rows in the terminal.
     */
    rows: number;

    /**
     * The number of columns in the terminal.
     */
    cols: number;
}

const MINIMUM_COLS = 2;
const MINIMUM_ROWS = 1;
const DEFAULT_SCROLLBAR_WIDTH = 15; // Match xterm.js DEFAULT_SCROLL_BAR_WIDTH

export class FitAddon implements ITerminalAddon, IFitApi {
    private _terminal: Terminal | undefined;
    public noScrollbar: boolean = false;

    public activate(terminal: Terminal): void {
        this._terminal = terminal;
    }

    public dispose(): void {}

    public fit(): void {
        const dims = this.proposeDimensions();
        if (!dims || !this._terminal || isNaN(dims.cols) || isNaN(dims.rows)) {
            return;
        }

        if (this._terminal.rows !== dims.rows || this._terminal.cols !== dims.cols) {
            this._terminal.resize(dims.cols, dims.rows);
        }
    }

    public proposeDimensions(): ITerminalDimensions | undefined {
        if (!this._terminal) {
            return undefined;
        }

        if (!this._terminal.element || !this._terminal.element.parentElement) {
            return undefined;
        }

        // Use public API from xterm.js 6.1.0 (PR #5551)
        const dims: IRenderDimensions | undefined = this._terminal.dimensions;
        if (!dims) {
            return undefined;
        }

        if (dims.css.cell.width === 0 || dims.css.cell.height === 0) {
            return undefined;
        }

        let scrollbarWidth = 0;
        if (!this.noScrollbar && this._terminal.options.scrollback !== 0) {
            scrollbarWidth = this._terminal.options.overviewRuler?.width ?? DEFAULT_SCROLLBAR_WIDTH;
        }

        const parentElementStyle = window.getComputedStyle(this._terminal.element.parentElement);
        const parentElementHeight = parseInt(parentElementStyle.getPropertyValue("height"));
        const parentElementWidth = Math.max(0, parseInt(parentElementStyle.getPropertyValue("width")));
        const elementStyle = window.getComputedStyle(this._terminal.element);
        const elementPadding = {
            top: parseInt(elementStyle.getPropertyValue("padding-top")),
            bottom: parseInt(elementStyle.getPropertyValue("padding-bottom")),
            right: parseInt(elementStyle.getPropertyValue("padding-right")),
            left: parseInt(elementStyle.getPropertyValue("padding-left")),
        };
        const elementPaddingVer = elementPadding.top + elementPadding.bottom;
        const elementPaddingHor = elementPadding.right + elementPadding.left;
        const availableHeight = parentElementHeight - elementPaddingVer;
        const availableWidth = parentElementWidth - elementPaddingHor - scrollbarWidth;
        const geometry = {
            cols: Math.max(MINIMUM_COLS, Math.floor(availableWidth / dims.css.cell.width)),
            rows: Math.max(MINIMUM_ROWS, Math.floor(availableHeight / dims.css.cell.height)),
        };
        return geometry;
    }
}
