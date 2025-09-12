// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { createBlock } from "@/store/global";
import { getWebServerEndpoint } from "@/util/endpoints";
import { stringToBase64 } from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";
import "./term.scss";

type StickerType = {
    position: "absolute";
    top?: number;
    left?: number;
    right?: number;
    bottom?: number;
    width?: number;
    height?: number;
    color?: string;
    opacity?: number;
    pointerevents?: boolean;
    fontsize?: number;
    transform?: string;

    stickertype: "icon" | "image" | "gauge";
    icon?: string;
    imgsrc?: string;
    clickcmd?: string;
    clickblockdef?: BlockDef;
};

type StickerTermConfig = {
    charWidth: number;
    charHeight: number;
    rows: number;
    cols: number;
    blockId: string;
};

function convertWidthDimToPx(dim: number, config: StickerTermConfig) {
    if (dim == null) {
        return null;
    }
    return dim * config.charWidth;
}

function convertHeightDimToPx(dim: number, config: StickerTermConfig) {
    if (dim == null) {
        return null;
    }
    return dim * config.charHeight;
}

var valueAtom = jotai.atom(Math.random() * 100);

function TermSticker({ sticker, config }: { sticker: StickerType; config: StickerTermConfig }) {
    let style: React.CSSProperties = {
        position: sticker.position,
        top: convertHeightDimToPx(sticker.top, config),
        left: convertWidthDimToPx(sticker.left, config),
        right: convertWidthDimToPx(sticker.right, config),
        bottom: convertHeightDimToPx(sticker.bottom, config),
        width: convertWidthDimToPx(sticker.width, config),
        height: convertHeightDimToPx(sticker.height, config),
        color: sticker.color,
        fontSize: sticker.fontsize,
        transform: sticker.transform,
        opacity: sticker.opacity,
        fill: sticker.color,
        stroke: sticker.color,
    };
    if (sticker.pointerevents) {
        style.pointerEvents = "auto";
    }
    if (style.width != null) {
        style.overflowX = "hidden";
    }
    if (style.height != null) {
        style.overflowY = "hidden";
    }
    let clickHandler = null;
    if (sticker.pointerevents && (sticker.clickcmd || sticker.clickblockdef)) {
        style.cursor = "pointer";
        clickHandler = () => {
            console.log("clickHandler", sticker.clickcmd, sticker.clickblockdef);
            if (sticker.clickcmd) {
                const b64data = stringToBase64(sticker.clickcmd);
                RpcApi.ControllerInputCommand(TabRpcClient, { blockid: config.blockId, inputdata64: b64data });
            }
            if (sticker.clickblockdef) {
                createBlock(sticker.clickblockdef);
            }
        };
    }
    if (sticker.stickertype == "icon") {
        return (
            <div className="term-sticker" style={style} onClick={clickHandler}>
                <i className={clsx("fa", "fa-" + sticker.icon)} />
            </div>
        );
    }
    if (sticker.stickertype == "image") {
        if (sticker.imgsrc == null) {
            return null;
        }
        const streamingUrl =
            getWebServerEndpoint() + "/wave/stream-local-file?path=" + encodeURIComponent(sticker.imgsrc);
        return (
            <div className="term-sticker term-sticker-image" style={style} onClick={clickHandler}>
                <img src={streamingUrl} />
            </div>
        );
    }
    return null;
}

export function TermStickers({ config }: { config: StickerTermConfig }) {
    let stickers: StickerType[] = [];
    if (config.blockId.startsWith("d1eaddcb")) {
        stickers.push({
            position: "absolute",
            top: 5,
            right: 7,
            stickertype: "icon",
            icon: "paw",
            color: "#40cc40aa",
            fontsize: 30,
            transform: "rotate(-18deg)",
            pointerevents: true,
            clickcmd: "ls\n",
        });
        stickers.push({
            position: "absolute",
            top: 8,
            right: 8,
            stickertype: "icon",
            icon: "paw",
            color: "#4040ccaa",
            fontsize: 30,
            transform: "rotate(-20deg)",
            pointerevents: true,
            clickcmd: "git status\n",
        });
        stickers.push({
            position: "absolute",
            top: 2,
            right: 25,
            width: 20,
            stickertype: "gauge",
            opacity: 0.7,
        });
    }
    return (
        <div className="term-stickers">
            {stickers.map((sticker, i) => (
                <TermSticker key={i} sticker={sticker} config={config} />
            ))}
        </div>
    );
}
