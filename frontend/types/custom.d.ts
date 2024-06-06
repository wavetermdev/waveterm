// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

declare global {
    type UIContext = {
        windowid: string;
        activetabid: string;
    };

    type MetadataType = { [key: string]: any };

    type ORef = {
        otype: string;
        oid: string;
    };

    interface WaveObj {
        otype: string;
        oid: string;
        version: number;
    }

    type WaveObjUpdate = {
        updatetype: "update" | "delete";
        otype: string;
        oid: string;
        obj?: WaveObj;
    };

    type Block = WaveObj & {
        blockdef: BlockDef;
        controller: string;
        view: string;
        meta?: { [key: string]: any };
        runtimeopts?: RuntimeOpts;
    };

    type BlockDef = {
        controller?: string;
        view?: string;
        files?: { [key: string]: FileDef };
        meta?: { [key: string]: any };
    };

    type FileDef = {
        filetype?: string;
        path?: string;
        url?: string;
        content?: string;
        meta?: { [key: string]: any };
    };

    type TermSize = {
        rows: number;
        cols: number;
    };

    type Client = {
        otype: string;
        oid: string;
        version: number;
        mainwindowid: string;
    };

    type Tab = {
        otype: string;
        oid: string;
        version: number;
        name: string;
        blockids: string[];
        layoutNode: string;
    };

    type Point = {
        x: number;
        y: number;
    };

    type WinSize = {
        width: number;
        height: number;
    };

    type Workspace = {
        otype: string;
        oid: string;
        version: number;
        name: string;
        tabids: string[];
    };

    type RuntimeOpts = {
        termsize?: TermSize;
        winsize?: WinSize;
    };

    type WaveWindow = {
        otype: string;
        oid: string;
        version: number;
        workspaceid: string;
        activetabid: string;
        activeblockmap: { [key: string]: string };
        pos: Point;
        winsize: WinSize;
        lastfocusts: number;
    };

    type TabLayoutData = {
        blockId: string;
    };
}

export {};
