// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useHeight } from "@/app/hook/useHeight";
import { useWidth } from "@/app/hook/useWidth";
import { WOS } from "@/store/global";
import { WshServer } from "@/store/wshserver";
import * as Plot from "@observablehq/plot";
import dayjs from "dayjs";
import * as htl from "htl";
import * as jotai from "jotai";
import * as React from "react";

import "./cpuplot.less";

type Point = {
    time: number; // note this is in seconds not milliseconds
    value: number;
};

class CpuPlotViewModel {
    blockAtom: jotai.Atom<Block>;
    termMode: jotai.Atom<string>;
    htmlElemFocusRef: React.RefObject<HTMLInputElement>;
    blockId: string;
    viewIcon: jotai.Atom<string>;
    viewText: jotai.Atom<string>;
    viewName: jotai.Atom<string>;
    dataAtom: jotai.PrimitiveAtom<Array<Point>>;
    addDataAtom: jotai.WritableAtom<unknown, [Point], void>;
    width: number;
    incrementCount: jotai.WritableAtom<unknown, [], Promise<void>>;

    constructor(blockId: string) {
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.width = 100;
        this.dataAtom = jotai.atom(this.getDefaultData());
        this.addDataAtom = jotai.atom(null, (get, set, point) => {
            // not efficient but should be okay for a demo?
            const data = get(this.dataAtom);
            set(this.dataAtom, [...data.slice(1), point]);
        });

        this.viewIcon = jotai.atom((get) => {
            return "chart-line"; // should not be hardcoded
        });
        this.viewName = jotai.atom((get) => {
            return "CPU %"; // should not be hardcoded
        });
        this.incrementCount = jotai.atom(null, async (get, set) => {
            const meta = get(this.blockAtom).meta;
            const count = meta.count ?? 0;
            await WshServer.SetMetaCommand({ oref: WOS.makeORef("block", this.blockId), meta: { count: count + 1 } });
        });
    }

    getDefaultData(): Array<Point> {
        // set it back one to avoid backwards line being possible
        const currentTime = Date.now() / 1000 - 1;
        const points = [];
        for (let i = this.width; i > -1; i--) {
            points.push({ time: currentTime - i, value: 0 });
        }
        return points;
    }
}

function makeCpuPlotViewModel(blockId: string): CpuPlotViewModel {
    const cpuPlotViewModel = new CpuPlotViewModel(blockId);
    return cpuPlotViewModel;
}

function CpuPlotView({ model }: { model: CpuPlotViewModel; blockId: string }) {
    const containerRef = React.useRef<HTMLInputElement>();
    const plotData = jotai.useAtomValue(model.dataAtom);
    const addPlotData = jotai.useSetAtom(model.addDataAtom);
    const parentHeight = useHeight(containerRef);
    const parentWidth = useWidth(containerRef);
    const block = jotai.useAtomValue(model.blockAtom);
    const incrementCount = jotai.useSetAtom(model.incrementCount); // temporary

    React.useEffect(() => {
        const temp = async () => {
            await incrementCount();
            const dataGen = WshServer.StreamCpuDataCommand(
                { id: model.blockId, count: (block.meta?.count ?? 0) + 1 },
                { timeout: 999999999, noresponse: false }
            );
            try {
                for await (const datum of dataGen) {
                    const ts = datum.ts;
                    addPlotData({ time: ts / 1000, value: datum.values?.["cpu"] });
                }
            } catch (e) {
                console.log(e);
            }
        };
        temp();
    }, []);

    React.useEffect(() => {
        const plot = Plot.plot({
            x: { grid: true, label: "time", tickFormat: (d) => `${dayjs.unix(d).format("HH:mm:ss")}` },
            y: { label: "%", domain: [0, 100] },
            width: parentWidth,
            height: parentHeight,
            marks: [
                () => htl.svg`<defs>
      <linearGradient id="gradient" gradientTransform="rotate(90)">
        <stop offset="0%" stop-color="#58C142" stop-opacity="0.7" />
        <stop offset="100%" stop-color="#58C142" stop-opacity="0" />
      </linearGradient>
	      </defs>`,
                Plot.lineY(plotData, {
                    stroke: "#58C142",
                    strokeWidth: 2,
                    x: "time",
                    y: "value",
                }),
                Plot.areaY(plotData, {
                    fill: "url(#gradient)",
                    x: "time",
                    y: "value",
                }),
            ],
        });

        if (plot !== undefined) {
            containerRef.current.append(plot);
        }

        return () => {
            if (plot !== undefined) {
                plot.remove();
            }
        };
    }, [plotData, parentHeight, parentWidth]);

    return <div className="plot-view" ref={containerRef} />;
}

export { CpuPlotView, CpuPlotViewModel, makeCpuPlotViewModel };
