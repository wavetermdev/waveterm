// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockService } from "@/bindings/blockservice";
import { getBlockSubject } from "@/store/global";
import { base64ToArray } from "@/util/util";
import { FitAddon } from "@xterm/addon-fit";
import type { ITheme } from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import * as React from "react";

import "./view.less";
import "/public/xterm.css";

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

type InitialLoadDataType = {
    loaded: boolean;
    heldData: Uint8Array[];
};

const TerminalView = ({ blockId }: { blockId: string }) => {
    const connectElemRef = React.useRef<HTMLDivElement>(null);
    const termRef = React.useRef<Terminal>(null);
    const initialLoadRef = React.useRef<InitialLoadDataType>({ loaded: false, heldData: [] });

    React.useEffect(() => {
        if (!connectElemRef.current) {
            return;
        }
        console.log("terminal created");
        const term = new Terminal({
            theme: getThemeFromCSSVars(connectElemRef.current),
            fontSize: 12,
            fontFamily: "Hack",
            drawBoldTextInBrightColors: false,
            fontWeight: "normal",
            fontWeightBold: "bold",
        });
        termRef.current = term;
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(connectElemRef.current);
        fitAddon.fit();
        BlockService.SendCommand(blockId, {
            command: "controller:input",
            termsize: { rows: term.rows, cols: term.cols },
        });
        term.onData((data) => {
            const b64data = btoa(data);
            const inputCmd = { command: "controller:input", blockid: blockId, inputdata64: b64data };
            BlockService.SendCommand(blockId, inputCmd);
        });
        // resize observer
        const rszObs = new ResizeObserver(() => {
            const oldRows = term.rows;
            const oldCols = term.cols;
            fitAddon.fit();
            if (oldRows !== term.rows || oldCols !== term.cols) {
                BlockService.SendCommand(blockId, {
                    command: "controller:input",
                    termsize: { rows: term.rows, cols: term.cols },
                });
            }
        });
        rszObs.observe(connectElemRef.current);

        // block subject
        const blockSubject = getBlockSubject(blockId);
        blockSubject.subscribe((data) => {
            // base64 decode
            const decodedData = base64ToArray(data.ptydata);
            if (initialLoadRef.current.loaded) {
                term.write(decodedData);
            } else {
                initialLoadRef.current.heldData.push(decodedData);
            }
        });

        return () => {
            term.dispose();
            rszObs.disconnect();
            blockSubject.release();
        };
    }, [connectElemRef.current]);

    React.useEffect(() => {
        if (!termRef.current) {
            return;
        }
        // load data from blockfile
        const startTs = Date.now();
        let loadedBytes = 0;
        const localTerm = termRef.current; // avoids devmode double effect running issue (terminal gets created twice)
        const usp = new URLSearchParams();
        usp.set("blockid", blockId);
        usp.set("name", "main");
        fetch("/wave/blockfile?" + usp.toString())
            .then((resp) => {
                if (resp.ok) {
                    return resp.arrayBuffer();
                }
                console.log("error loading blockfile", resp.status, resp.statusText);
            })
            .then((data: ArrayBuffer) => {
                const uint8View = new Uint8Array(data);
                localTerm.write(uint8View);
                loadedBytes = uint8View.byteLength;
            })
            .finally(() => {
                initialLoadRef.current.heldData.forEach((data) => {
                    localTerm.write(data);
                });
                initialLoadRef.current.loaded = true;
                initialLoadRef.current.heldData = [];
                console.log(`terminal loaded blockfile ${loadedBytes} bytes, ${Date.now() - startTs}ms`);
            });
    }, [termRef.current]);

    return (
        <div className="view-term">
            <div key="conntectElem" className="term-connectelem" ref={connectElemRef}></div>
        </div>
    );
};

export { TerminalView };
