// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useHeight } from "@/app/hook/useHeight";
import { useWidth } from "@/app/hook/useWidth";
import { getConnStatusAtom, globalStore, WOS } from "@/store/global";
import * as util from "@/util/util";
import * as Plot from "@observablehq/plot";
import dayjs from "dayjs";
import * as htl from "htl";
import * as jotai from "jotai";
import * as React from "react";

import { ContextMenuModel } from "@/app/store/contextmenu";
import { waveEventSubscribe } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { WindowRpcClient } from "@/app/store/wshrpcutil";
import "./cpuplot.less";

const DefaultNumPoints = 120;

type DataItem = {
    ts: number;
    [k: string]: number;
};

function defaultCpuMeta(name: string): TimeSeriesMeta {
    return {
        name: name,
        label: "%",
        miny: 0,
        maxy: 100,
    };
}

function defaultMemMeta(name: string, maxY: string): TimeSeriesMeta {
    return {
        name: name,
        label: "GB",
        miny: 0,
        maxy: maxY,
    };
}

const DefaultPlotMeta = {
    cpu: defaultCpuMeta("CPU %"),
    "mem:total": defaultMemMeta("Memory Total", "mem:total"),
    "mem:used": defaultMemMeta("Memory Used", "mem:total"),
    "mem:free": defaultMemMeta("Memory Free", "mem:total"),
    "mem:available": defaultMemMeta("Memory Available", "mem:total"),
};
for (let i = 0; i < 32; i++) {
    DefaultPlotMeta[`cpu:${i}`] = defaultCpuMeta(`CPU[${i}] %`);
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
    plotMetaAtom: jotai.PrimitiveAtom<Map<string, TimeSeriesMeta>>;
    endIconButtons: jotai.Atom<IconButtonDecl[]>;

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
        this.plotMetaAtom = jotai.atom(new Map(Object.entries(DefaultPlotMeta)));
        this.endIconButtons = jotai.atom((get) => {
            return [
                {
                    elemtype: "iconbutton",
                    label: "Plot Type",
                    icon: "wrench",
                    click: (e) => this.handleContextMenu(e),
                },
            ];
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
            const metrics = get(this.metrics);
            const meta = get(this.plotMetaAtom);
            if (metrics.length == 0) {
                return "unknown";
            }
            const metaSelected = meta.get(metrics[0]);
            if (!metaSelected) {
                return "unknown";
            }
            return metaSelected.name;
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

    handleContextMenu(e: React.MouseEvent<HTMLDivElement>) {
        e.preventDefault();
        e.stopPropagation();
        const plotData = globalStore.get(this.dataAtom);
        const metrics = globalStore.get(this.metrics);
        if (plotData.length == 0) {
            return;
        }
        const menu = Object.keys(plotData[plotData.length - 1])
            .filter((dataType) => dataType !== "ts")
            .map((dataType) => {
                const inMetrics = metrics.includes(dataType);
                const newMetrics = inMetrics ? metrics.filter((dt) => dt !== dataType) : [...metrics, dataType];
                const menuItem: ContextMenuItem = {
                    label: dataType,
                    type: "checkbox",
                    checked: inMetrics,
                    click: async () => {
                        await RpcApi.SetMetaCommand(WindowRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "graph:metrics": newMetrics },
                        });
                    },
                };
                return menuItem;
            });

        ContextMenuModel.showContextMenu(menu, e);
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

function resolveDomainBound(value: number | string, dataItem: DataItem): number | undefined {
    if (typeof value == "number") {
        return value;
    } else if (typeof value == "string") {
        return dataItem?.[value];
    } else {
        return undefined;
    }
}

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
    const parentHeight = useHeight(containerRef);
    const parentWidth = useWidth(containerRef);
    const yvals = jotai.useAtomValue(model.metrics);
    const plotMeta = jotai.useAtomValue(model.plotMetaAtom);

    React.useEffect(() => {
        if (yvals.length == 0) {
            // don't bother creating plots if none are selected
            return;
        }
        const singleItem = yvals.length == 1;

        const marks: Plot.Markish[] = [];
        yvals.forEach((yval, idx) => {
            // use rotating colors for
            // color not configured
            // plotting multiple items
            let color = plotMeta.get(yval)?.color;
            if (!color || !singleItem) {
                color = plotColors[idx];
            }
            marks.push(
                () => htl.svg`<defs>
      <linearGradient id="gradient-${model.blockId}-${yval}" gradientTransform="rotate(90)">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.7" />
        <stop offset="100%" stop-color="${color}" stop-opacity="0" />
      </linearGradient>
	      </defs>`
            );

            marks.push(
                Plot.lineY(plotData, {
                    stroke: color,
                    strokeWidth: singleItem ? 2 : 1,
                    x: "ts",
                    y: yval,
                })
            );

            // only add the gradient for single items
            if (singleItem) {
                marks.push(
                    Plot.areaY(plotData, {
                        fill: `url(#gradient-${model.blockId}-${yvals[0]})`,
                        x: "ts",
                        y: yval,
                    })
                );
            }
        });
        // use the largest configured yval.maxYs. if none is found, use 100
        const maxYs = yvals.map((yval) => resolveDomainBound(plotMeta.get(yval)?.maxy, plotData[plotData.length - 1]));
        let maxY = Math.max(...maxYs.filter(Number.isFinite));
        if (!Number.isFinite(maxY)) {
            maxY = 100;
        }
        // use the smalles configured yval.minYs. if none is found, use 0
        const minYs = yvals.map((yval) => resolveDomainBound(plotMeta.get(yval)?.miny, plotData[plotData.length - 1]));
        let minY = Math.min(...minYs.filter(Number.isFinite));
        if (!Number.isFinite(maxY)) {
            minY = 0;
        }
        const labelY = plotMeta.get(yvals[0])?.label ?? "?";
        const plot = Plot.plot({
            x: { grid: true, label: "time", tickFormat: (d) => `${dayjs.unix(d / 1000).format("HH:mm:ss")}` },
            y: { label: labelY, domain: [minY, maxY] },
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
    }, [plotData, parentHeight, parentWidth, yvals, plotMeta, model.blockId]);

    return <div className="plot-view" ref={containerRef} />;
});

export { CpuPlotView, CpuPlotViewModel, makeCpuPlotViewModel };
