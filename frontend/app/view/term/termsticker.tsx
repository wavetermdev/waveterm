// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WshServer } from "@/app/store/wshserver";
import { createBlock } from "@/store/global";
import { getServerWebEndpoint } from "@/util/endpoints";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";
import GaugeChart from "react-gauge-chart";
import "./term.less";

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

function GaugeSticker() {
    let [value, setValue] = jotai.useAtom(valueAtom);
    React.useEffect(() => {
        let interval = setInterval(() => {
            var amt = Math.random() * 10 - 5;
            setValue((value) => Math.max(0, Math.min(100, value + amt)));
        }, 1000);
        return () => clearInterval(interval);
    });
    return <GaugeChart id="gauge-chart1" nrOfLevels={20} percent={value / 100} />;
}

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
                const b64data = btoa(sticker.clickcmd);
                WshServer.BlockInputCommand({ blockid: config.blockId, inputdata64: b64data });
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
        const streamingUrl = getServerWebEndpoint() + "/wave/stream-file?path=" + encodeURIComponent(sticker.imgsrc);
        return (
            <div className="term-sticker term-sticker-image" style={style} onClick={clickHandler}>
                <img src={streamingUrl} />
            </div>
        );
    }
    if (sticker.stickertype == "gauge") {
        return (
            <div className="term-sticker term-sticker-gauge" style={style}>
                <GaugeSticker />
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
            top: 10,
            right: 5,
            stickertype: "icon",
            icon: "paw",
            color: "#cc4040aa",
            fontsize: 30,
            transform: "rotate(-15deg)",
            pointerevents: true,
            clickcmd: "cd ~/work/wails/thenextwave\n",
        });
        stickers.push({
            position: "absolute",
            top: 18,
            right: 8,
            stickertype: "image",
            width: 12,
            height: 6,
            imgsrc: "~/Downloads/natureicon.png",
            opacity: 0.8,
            pointerevents: true,
            clickblockdef: { view: "preview", meta: { file: "~/" } },
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
