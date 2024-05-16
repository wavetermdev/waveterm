// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

declare global {
    type MetaDataType = Record<string, any>;

    type TabData = {
        name: string;
        tabid: string;
        blockIds: string[];
    };

    type BlockData = {
        blockid: string;
        blockdef: BlockDef;
        controller: string;
        controllerstatus: string;
        view: string;
        meta?: MetaDataType;
    };

    type FileDef = {
        filetype?: string;
        path?: string;
        url?: string;
        content?: string;
        meta?: MetaDataType;
    };

    type BlockDef = {
        controller?: string;
        view: string;
        files?: FileDef[];
        meta?: MetaDataType;
    };

    type FileInfo = {
        path: string;
        notfound: boolean;
        size: number;
        mode: number;
        modtime: number;
        isdir: boolean;
        mimetype: string;
    };

    type FullFile = {
        info: FileInfo;
        data64: string;
    };
}

export {};
