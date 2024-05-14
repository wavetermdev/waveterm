// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import { Terminal } from "@xterm/xterm";
import type { ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import "/public/xterm.css";
import "./block.less";

function getThemeFromCSSVars(el: Element): ITheme {
    const theme: ITheme = {};
    const elemStyle = getComputedStyle(el);
    theme.foreground = elemStyle.getPropertyValue("--term-foreground");
    theme.background = elemStyle.getPropertyValue("--term-background");
    theme.black = elemStyle.getPropertyValue("--term-black");
    theme.red = elemStyle.getPropertyValue("--term-red");
    theme.green = elemStyle.getPropertyValue("--term-green");
    theme.yellow = elemStyle.getPropertyValue("--term-yellow");
    theme.blue = elemStyle.getPropertyValue("--term-blue");
    theme.magenta = elemStyle.getPropertyValue("--term-magenta");
    theme.cyan = elemStyle.getPropertyValue("--term-cyan");
    theme.white = elemStyle.getPropertyValue("--term-white");
    theme.brightBlack = elemStyle.getPropertyValue("--term-bright-black");
    theme.brightRed = elemStyle.getPropertyValue("--term-bright-red");
    theme.brightGreen = elemStyle.getPropertyValue("--term-bright-green");
    theme.brightYellow = elemStyle.getPropertyValue("--term-bright-yellow");
    theme.brightBlue = elemStyle.getPropertyValue("--term-bright-blue");
    theme.brightMagenta = elemStyle.getPropertyValue("--term-bright-magenta");
    theme.brightCyan = elemStyle.getPropertyValue("--term-bright-cyan");
    theme.brightWhite = elemStyle.getPropertyValue("--term-bright-white");
    theme.selectionBackground = elemStyle.getPropertyValue("--term-selection-background");
    theme.selectionInactiveBackground = elemStyle.getPropertyValue("--term-selection-background");
    theme.cursor = elemStyle.getPropertyValue("--term-selection-background");
    theme.cursorAccent = elemStyle.getPropertyValue("--term-cursor-accent");
    return theme;
}

const Block = ({ blockId }: { blockId: string }) => {
    const blockRef = React.useRef<HTMLDivElement>(null);
    const connectElemRef = React.useRef<HTMLDivElement>(null);
    const [dims, setDims] = React.useState({ width: 0, height: 0 });
    React.useEffect(() => {
        if (!blockRef.current) {
            return;
        }
        const rect = blockRef.current.getBoundingClientRect();
        const newWidth = parseInt(rect.width);
        const newHeight = parseInt(rect.height);
        if (newWidth !== dims.width || newHeight !== dims.height) {
            setDims({ width: newWidth, height: newHeight });
        }
    }, [blockRef.current]);
    React.useEffect(() => {
        const term = new Terminal({
            theme: getThemeFromCSSVars(blockRef.current),
            fontSize: 12,
            fontFamily: "Hack",
            drawBoldTextInBrightColors: false,
            fontWeight: "normal",
            fontWeightBold: "bold",
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(connectElemRef.current);
        fitAddon.fit();
        term.write("Hello, world!");
        return () => {
            term.dispose();
        };
    }, [connectElemRef.current]);
    return (
        <div className="block" ref={blockRef}>
            <div key="header" className="block-header">
                <div className="text-fixed">
                    Block [{blockId.substring(0, 8)}] {dims.width}x{dims.height}
                </div>
            </div>
            <div key="conntectElem" className="block-term-connectelem" ref={connectElemRef}></div>
        </div>
    );
};

export { Block };
