// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getConnStatusAtom, globalStore, WOS } from "@/store/global";
import * as util from "@/util/util";
import * as Plot from "@observablehq/plot";
import dayjs from "dayjs";
import * as htl from "htl";
import * as jotai from "jotai";
import * as React from "react";

import { useDimensionsWithExistingRef } from "@/app/hook/useDimensions";
import { waveEventSubscribe } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { WindowRpcClient } from "@/app/store/wshrpcutil";
import "./cpuplot.less";

const DefaultNumPoints = 120;

type DataItem = {
    ts: number;
    [k: string]: number;
};

const SysInfoMetricNames = {
    cpu: "CPU %",
    "mem:total": "Memory Total",
    "mem:used": "Memory Used",
    "mem:free": "Memory Free",
    "mem:available": "Memory Available",
};
for (let i = 0; i < 32; i++) {
    SysInfoMetricNames[`cpu:${i}`] = `CPU[${i}] %`;
}

function convertWaveEventToDataItem(event: WaveEvent): DataItem {
    const eventData: TimeSeriesData = event.data;
    if (eventData == null || eventData.ts == null || eventData.values == null) {
        return null;
    }
    const dataItem = { ts: eventData.ts };
    for (const key in eventData.values) {
        dataItem[key] = eventData.values[key];
    }
    return dataItem;
}

class CpuPlotViewModel {
    viewType: string;
    blockAtom: jotai.Atom<Block>;
    termMode: jotai.Atom<string>;
    htmlElemFocusRef: React.RefObject<HTMLInputElement>;
    blockId: string;
    viewIcon: jotai.Atom<string>;
    viewText: jotai.Atom<string>;
    viewName: jotai.Atom<string>;
    dataAtom: jotai.PrimitiveAtom<Array<DataItem>>;
    addDataAtom: jotai.WritableAtom<unknown, [DataItem[]], void>;
    incrementCount: jotai.WritableAtom<unknown, [], Promise<void>>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;
    numPoints: jotai.Atom<number>;
    metrics: jotai.Atom<string[]>;
    connection: jotai.Atom<string>;
    manageConnection: jotai.Atom<boolean>;
    connStatus: jotai.Atom<ConnStatus>;

    constructor(blockId: string) {
        this.viewType = "cpuplot";
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.addDataAtom = jotai.atom(null, (get, set, points) => {
            const targetLen = get(this.numPoints) + 1;
            let data = get(this.dataAtom);
            try {
                if (data.length > targetLen) {
                    data = data.slice(data.length - targetLen);
                }
                if (data.length < targetLen) {
                    const defaultData = this.getDefaultData();
                    data = [...defaultData.slice(defaultData.length - targetLen + data.length), ...data];
                }
                const newData = [...data.slice(points.length), ...points];
                set(this.dataAtom, newData);
            } catch (e) {
                console.log("Error adding data to cpuplot", e);
            }
        });
        this.manageConnection = jotai.atom(true);
        this.loadingAtom = jotai.atom(true);
        this.numPoints = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const metaNumPoints = blockData?.meta?.["graph:numpoints"];
            if (metaNumPoints == null || metaNumPoints <= 0) {
                return DefaultNumPoints;
            }
            return metaNumPoints;
        });
        this.metrics = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const metrics = blockData?.meta?.["graph:metrics"];
            if (metrics == null || !Array.isArray(metrics)) {
                return ["cpu"];
            }
            return metrics;
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
            await RpcApi.SetMetaCommand(WindowRpcClient, {
                oref: WOS.makeORef("block", this.blockId),
                meta: { count: count + 1 },
            });
        });
        this.connection = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const connValue = blockData?.meta?.connection;
            if (util.isBlank(connValue)) {
                return "local";
            }
            return connValue;
        });
        this.dataAtom = jotai.atom(this.getDefaultData());
        this.loadInitialData();
        this.connStatus = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const connName = blockData?.meta?.connection;
            const connAtom = getConnStatusAtom(connName);
            return get(connAtom);
        });
    }

    async loadInitialData() {
        globalStore.set(this.loadingAtom, true);
        try {
            const numPoints = globalStore.get(this.numPoints);
            const connName = globalStore.get(this.connection);
            const initialData = await RpcApi.EventReadHistoryCommand(WindowRpcClient, {
                event: "sysinfo",
                scope: connName,
                maxitems: numPoints,
            });
            if (initialData == null) {
                return;
            }
            const newData = this.getDefaultData();
            const initialDataItems: DataItem[] = initialData.map(convertWaveEventToDataItem);
            // splice the initial data into the default data (replacing the newest points)
            newData.splice(newData.length - initialDataItems.length, initialDataItems.length, ...initialDataItems);
            globalStore.set(this.addDataAtom, newData);
        } catch (e) {
            console.log("Error loading initial data for cpuplot", e);
        } finally {
            globalStore.set(this.loadingAtom, false);
        }
    }

    getDefaultData(): DataItem[] {
        // set it back one to avoid backwards line being possible
        const numPoints = globalStore.get(this.numPoints);
        const currentTime = Date.now() - 1000;
        const points: DataItem[] = [];
        for (let i = numPoints; i > -1; i--) {
            points.push({ ts: currentTime - i * 1000 });
        }
        return points;
    }
}

function makeCpuPlotViewModel(blockId: string): CpuPlotViewModel {
    const cpuPlotViewModel = new CpuPlotViewModel(blockId);
    return cpuPlotViewModel;
}

const plotColors = ["#58C142", "#FFC107", "#FF5722", "#2196F3", "#9C27B0", "#00BCD4", "#FFEB3B", "#795548"];

type CpuPlotViewProps = {
    blockId: string;
    model: CpuPlotViewModel;
};

function CpuPlotView({ model, blockId }: CpuPlotViewProps) {
    const connName = jotai.useAtomValue(model.connection);
    const lastConnName = React.useRef(connName);
    const connStatus = jotai.useAtomValue(model.connStatus);
    const addPlotData = jotai.useSetAtom(model.addDataAtom);
    const loading = jotai.useAtomValue(model.loadingAtom);

    React.useEffect(() => {
        if (connStatus?.status != "connected") {
            return;
        }
        if (lastConnName.current !== connName) {
            lastConnName.current = connName;
            model.loadInitialData();
        }
    }, [connStatus.status, connName]);
    React.useEffect(() => {
        const unsubFn = waveEventSubscribe({
            eventType: "sysinfo",
            scope: connName,
            handler: (event) => {
                const loading = globalStore.get(model.loadingAtom);
                if (loading) {
                    return;
                }
                const dataItem = convertWaveEventToDataItem(event);
                addPlotData([dataItem]);
            },
        });
        console.log("subscribe to sysinfo", connName);
        return () => {
            unsubFn();
        };
    }, [connName]);
    if (connStatus?.status != "connected") {
        return null;
    }
    if (loading) {
        return null;
    }
    return <CpuPlotViewInner key={connStatus?.connection ?? "local"} blockId={blockId} model={model} />;
}

const CpuPlotViewInner = React.memo(({ model }: CpuPlotViewProps) => {
    const containerRef = React.useRef<HTMLInputElement>();
    const plotData = jotai.useAtomValue(model.dataAtom);
    const domRect = useDimensionsWithExistingRef(containerRef, 30);
    const parentHeight = domRect?.height ?? 0;
    const parentWidth = domRect?.width ?? 0;
    const yvals = jotai.useAtomValue(model.metrics);

    React.useEffect(() => {
        const marks: Plot.Markish[] = [];
        marks.push(
            () => htl.svg`<defs>
      <linearGradient id="gradient" gradientTransform="rotate(90)">
        <stop offset="0%" stop-color="#58C142" stop-opacity="0.7" />
        <stop offset="100%" stop-color="#58C142" stop-opacity="0" />
      </linearGradient>
	      </defs>`
        );
        if (yvals.length == 0) {
            // nothing
        } else if (yvals.length == 1) {
            marks.push(
                Plot.lineY(plotData, {
                    stroke: plotColors[0],
                    strokeWidth: 2,
                    x: "ts",
                    y: yvals[0],
                })
            );
            marks.push(
                Plot.areaY(plotData, {
                    fill: "url(#gradient)",
                    x: "ts",
                    y: yvals[0],
                })
            );
        } else {
            let idx = 0;
            for (const yval of yvals) {
                marks.push(
                    Plot.lineY(plotData, {
                        stroke: plotColors[idx % plotColors.length],
                        strokeWidth: 1,
                        x: "ts",
                        y: yval,
                    })
                );
                idx++;
            }
        }
        const plot = Plot.plot({
            x: { grid: true, label: "time", tickFormat: (d) => `${dayjs.unix(d / 1000).format("HH:mm:ss")}` },
            y: { label: "%", domain: [0, 100] },
            width: parentWidth,
            height: parentHeight,
            marks: marks,
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
});

export { CpuPlotView, CpuPlotViewModel, makeCpuPlotViewModel };
