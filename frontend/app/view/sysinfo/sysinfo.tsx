// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { makeORef } from "@/app/store/wos";
import * as util from "@/util/util";
import * as Plot from "@observablehq/plot";
import clsx from "clsx";
import dayjs from "dayjs";
import * as htl from "htl";
import * as jotai from "jotai";
import * as React from "react";

import { useDimensionsWithExistingRef } from "@/app/hook/useDimensions";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { MetaKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";

export type SysinfoEnv = WaveEnvSubset<{
    rpc: {
        EventReadHistoryCommand: WaveEnv["rpc"]["EventReadHistoryCommand"];
        SetMetaCommand: WaveEnv["rpc"]["SetMetaCommand"];
    };
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
    };
    getConnStatusAtom: WaveEnv["getConnStatusAtom"];
    getBlockMetaKeyAtom: MetaKeyAtomFnType<"graph:numpoints" | "graph:metrics" | "sysinfo:type" | "connection" | "count">;
}>;

const DefaultNumPoints = 120;
const DefaultMetricKeys = ["cpu"];
const DefaultCpuCoreCount = 32;
const DefaultGpuCount = 16;

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
        color: "var(--sysinfo-cpu-color)",
        decimalPlaces: 0,
    };
}

function defaultMemMeta(name: string, maxY: string): TimeSeriesMeta {
    return {
        name: name,
        label: "GB",
        miny: 0,
        maxy: maxY,
        color: "var(--sysinfo-mem-color)",
        decimalPlaces: 1,
    };
}

function defaultGpuMeta(name: string): TimeSeriesMeta {
    return {
        name: name,
        label: "%",
        miny: 0,
        maxy: 100,
        color: "var(--sysinfo-gpu-color)",
        decimalPlaces: 0,
    };
}

function defaultGpuMemMeta(name: string, maxY: string): TimeSeriesMeta {
    return {
        name: name,
        label: "GB",
        miny: 0,
        maxy: maxY,
        color: "var(--sysinfo-gpu-color)",
        decimalPlaces: 1,
    };
}

type PlotTypeFn = (dataItem: DataItem | null) => Array<string>;

function getIndexedMetrics(dataItem: DataItem | null, prefix: string): Array<string> {
    return Object.keys(dataItem ?? {})
        .filter((item) => {
            if (!item.startsWith(prefix)) {
                return false;
            }
            const metricIdx = Number(item.slice(prefix.length));
            return Number.isInteger(metricIdx);
        })
        .sort((a, b) => {
            const valA = Number(a.slice(prefix.length));
            const valB = Number(b.slice(prefix.length));
            return valA - valB;
        });
}

function getCpuCoreMetrics(dataItem: DataItem | null): Array<string> {
    return getIndexedMetrics(dataItem, "cpu:");
}

function getGpuMetrics(dataItem: DataItem | null): Array<string> {
    return getIndexedMetrics(dataItem, "gpu:");
}

const LegacyPlotTypes: Record<string, PlotTypeFn> = {
    CPU: function (_dataItem: DataItem | null): Array<string> {
        return ["cpu"];
    },
    Mem: function (_dataItem: DataItem | null): Array<string> {
        return ["mem:used"];
    },
    "CPU + Mem": function (_dataItem: DataItem | null): Array<string> {
        return ["cpu", "mem:used"];
    },
    "All CPU": function (dataItem: DataItem | null): Array<string> {
        return getCpuCoreMetrics(dataItem);
    },
};

const MetricToggles: Array<{ label: string; getMetrics: PlotTypeFn; sublabel?: string }> = [
    {
        label: "CPU",
        getMetrics: function (_dataItem: DataItem | null): Array<string> {
            return ["cpu"];
        },
    },
    {
        label: "Mem",
        getMetrics: function (_dataItem: DataItem | null): Array<string> {
            return ["mem:used"];
        },
    },
    {
        label: "GPU",
        sublabel: "Installed GPU tools",
        getMetrics: function (dataItem: DataItem | null): Array<string> {
            if (typeof dataItem?.gpu != "number" || !Number.isFinite(dataItem.gpu)) {
                return [];
            }
            return ["gpu"];
        },
    },
    {
        label: "All CPU Cores",
        getMetrics: getCpuCoreMetrics,
    },
    {
        label: "All GPUs",
        getMetrics: getGpuMetrics,
    },
];

const DefaultPlotMeta: Record<string, TimeSeriesMeta> = {
    cpu: defaultCpuMeta("CPU %"),
    "mem:total": defaultMemMeta("Memory Total", "mem:total"),
    "mem:used": defaultMemMeta("Memory Used", "mem:total"),
    "mem:free": defaultMemMeta("Memory Free", "mem:total"),
    "mem:available": defaultMemMeta("Memory Available", "mem:total"),
    gpu: defaultGpuMeta("GPU %"),
    "gpumem:total": defaultGpuMemMeta("GPU Memory Total", "gpumem:total"),
    "gpumem:used": defaultGpuMemMeta("GPU Memory Used", "gpumem:total"),
};
for (let i = 0; i < DefaultCpuCoreCount; i++) {
    DefaultPlotMeta[`cpu:${i}`] = defaultCpuMeta(`Core ${i}`);
}
for (let i = 0; i < DefaultGpuCount; i++) {
    DefaultPlotMeta[`gpu:${i}`] = defaultGpuMeta(`GPU ${i}`);
    DefaultPlotMeta[`gpumem:${i}:total`] = defaultGpuMemMeta(`GPU ${i} Memory Total`, `gpumem:${i}:total`);
    DefaultPlotMeta[`gpumem:${i}:used`] = defaultGpuMemMeta(`GPU ${i} Memory Used`, `gpumem:${i}:total`);
}

function dedupeMetricKeys(metrics: Array<string>): Array<string> {
    return [...new Set(metrics.filter((metric) => typeof metric == "string" && metric != ""))];
}

function getLegacyPlotMetrics(plotType: string, dataItem: DataItem | null): Array<string> {
    const plotFn = LegacyPlotTypes[plotType] ?? LegacyPlotTypes.CPU;
    return plotFn(dataItem);
}

function resolveSelectedMetricKeys(metaMetrics: unknown, plotType: string, dataItem: DataItem | null): Array<string> {
    if (Array.isArray(metaMetrics)) {
        const metricKeys = dedupeMetricKeys(metaMetrics);
        if (metricKeys.length > 0) {
            return metricKeys;
        }
    }
    const legacyMetricKeys = getLegacyPlotMetrics(plotType, dataItem);
    if (legacyMetricKeys.length > 0) {
        return legacyMetricKeys;
    }
    return DefaultMetricKeys;
}

function toggleMetricKeys(currentMetrics: Array<string>, toggledMetrics: Array<string>): Array<string> {
    if (toggledMetrics.length == 0) {
        return currentMetrics;
    }
    const metricSet = new Set(currentMetrics);
    const removeMetrics = toggledMetrics.every((metric) => metricSet.has(metric));
    if (removeMetrics) {
        toggledMetrics.forEach((metric) => metricSet.delete(metric));
    } else {
        toggledMetrics.forEach((metric) => metricSet.add(metric));
    }
    const nextMetrics = Array.from(metricSet);
    if (nextMetrics.length == 0) {
        return DefaultMetricKeys;
    }
    return nextMetrics;
}

function getMetricDisplayName(metric: string): string {
    if (metric == "cpu") {
        return "CPU";
    }
    if (metric == "mem:used") {
        return "Mem";
    }
    if (metric == "gpu") {
        return "GPU";
    }
    if (metric.startsWith("cpu:")) {
        return `Core ${metric.slice("cpu:".length)}`;
    }
    if (metric.startsWith("gpu:")) {
        return `GPU ${metric.slice("gpu:".length)}`;
    }
    return metric;
}

function getMetricsViewName(metrics: Array<string>): string {
    if (metrics.length == 0) {
        return "CPU";
    }
    if (metrics.length <= 3) {
        return metrics.map(getMetricDisplayName).join(" + ");
    }
    return `${metrics.length} Plots`;
}

function convertWaveEventToDataItem(event: Extract<WaveEvent, { event: "sysinfo" }>): DataItem | null {
    const eventData = event.data;
    if (eventData == null || eventData.ts == null || eventData.values == null) {
        return null;
    }
    const dataItem: DataItem = { ts: eventData.ts };
    for (const key in eventData.values) {
        dataItem[key] = eventData.values[key];
    }
    return dataItem;
}

function isDataItem(dataItem: DataItem | null): dataItem is DataItem {
    return dataItem != null && typeof dataItem.ts == "number";
}

class SysinfoViewModel implements ViewModel {
    viewType: string;
    termMode: jotai.Atom<string>;
    htmlElemFocusRef: React.RefObject<HTMLInputElement>;
    blockId: string;
    viewIcon: jotai.Atom<string>;
    viewText: jotai.Atom<string>;
    viewName: jotai.Atom<string>;
    dataAtom: jotai.PrimitiveAtom<Array<DataItem>>;
    addInitialDataAtom: jotai.WritableAtom<unknown, [DataItem[]], void>;
    addContinuousDataAtom: jotai.WritableAtom<unknown, [DataItem], void>;
    incrementCount: jotai.WritableAtom<unknown, [], Promise<void>>;
    loadingAtom: jotai.PrimitiveAtom<boolean>;
    numPoints: jotai.Atom<number>;
    metrics: jotai.Atom<string[]>;
    connection: jotai.Atom<string>;
    manageConnection: jotai.Atom<boolean>;
    filterOutNowsh: jotai.Atom<boolean>;
    connStatus: jotai.Atom<ConnStatus>;
    plotMetaAtom: jotai.PrimitiveAtom<Map<string, TimeSeriesMeta>>;
    endIconButtons: jotai.Atom<IconButtonDecl[]>;
    plotTypeSelectedAtom: jotai.Atom<string>;
    env: SysinfoEnv;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.viewType = "sysinfo";
        this.blockId = blockId;
        this.env = waveEnv;
        this.addInitialDataAtom = jotai.atom(null, (get, set, points) => {
            const targetLen = get(this.numPoints) + 1;
            try {
                const newDataRaw = [...points];
                if (newDataRaw.length == 0) {
                    return;
                }
                const latestItemTs = newDataRaw[newDataRaw.length - 1]?.ts ?? 0;
                const cutoffTs = latestItemTs - 1000 * targetLen;
                const blankItemTemplate = { ...newDataRaw[newDataRaw.length - 1] };
                for (const key in blankItemTemplate) {
                    blankItemTemplate[key] = NaN;
                }

                const newDataFiltered = newDataRaw.filter((dataItem) => dataItem.ts >= cutoffTs);
                if (newDataFiltered.length == 0) {
                    return;
                }
                const newDataWithGaps: Array<DataItem> = [];
                if (newDataFiltered[0].ts > cutoffTs) {
                    const blankItemStart = { ...blankItemTemplate, ts: cutoffTs };
                    const blankItemEnd = { ...blankItemTemplate, ts: newDataFiltered[0].ts - 1 };
                    newDataWithGaps.push(blankItemStart);
                    newDataWithGaps.push(blankItemEnd);
                }
                newDataWithGaps.push(newDataFiltered[0]);
                for (let i = 1; i < newDataFiltered.length; i++) {
                    const prevIdxItem = newDataFiltered[i - 1];
                    const curIdxItem = newDataFiltered[i];
                    const timeDiff = curIdxItem.ts - prevIdxItem.ts;
                    if (timeDiff > 2000) {
                        const blankItemStart = { ...blankItemTemplate, ts: prevIdxItem.ts + 1, blank: 1 };
                        const blankItemEnd = { ...blankItemTemplate, ts: curIdxItem.ts - 1, blank: 1 };
                        newDataWithGaps.push(blankItemStart);
                        newDataWithGaps.push(blankItemEnd);
                    }
                    newDataWithGaps.push(curIdxItem);
                }
                set(this.dataAtom, newDataWithGaps);
            } catch (e) {
                console.log("Error adding data to sysinfo", e);
            }
        });
        this.addContinuousDataAtom = jotai.atom(null, (get, set, newPoint) => {
            const targetLen = get(this.numPoints) + 1;
            const data = get(this.dataAtom);
            try {
                const latestItemTs = newPoint?.ts ?? 0;
                const cutoffTs = latestItemTs - 1000 * targetLen;
                data.push(newPoint);
                const newData = data.filter((dataItem) => dataItem.ts >= cutoffTs);
                set(this.dataAtom, newData);
            } catch (e) {
                console.log("Error adding data to sysinfo", e);
            }
        });
        this.plotMetaAtom = jotai.atom(new Map(Object.entries(DefaultPlotMeta)));
        this.manageConnection = jotai.atom(true);
        this.filterOutNowsh = jotai.atom(true);
        this.loadingAtom = jotai.atom(true);
        this.numPoints = jotai.atom((get) => {
            const metaNumPoints = get(this.env.getBlockMetaKeyAtom(blockId, "graph:numpoints"));
            if (metaNumPoints == null || metaNumPoints <= 0) {
                return DefaultNumPoints;
            }
            return metaNumPoints;
        });
        this.plotTypeSelectedAtom = jotai.atom((get) => {
            const plotType = get(this.env.getBlockMetaKeyAtom(blockId, "sysinfo:type"));
            if (plotType == null || typeof plotType != "string") {
                return "CPU";
            }
            return plotType;
        });
        this.metrics = jotai.atom((get) => {
            const plotData = get(this.dataAtom);
            const latestDataItem = plotData[plotData.length - 1];
            const metaMetrics = get(this.env.getBlockMetaKeyAtom(blockId, "graph:metrics"));
            const plotType = get(this.plotTypeSelectedAtom);
            return resolveSelectedMetricKeys(metaMetrics, plotType, latestDataItem);
        });
        this.viewIcon = jotai.atom((get) => {
            return "chart-line"; // should not be hardcoded
        });
        this.viewName = jotai.atom((get) => {
            return getMetricsViewName(get(this.metrics));
        });
        this.incrementCount = jotai.atom(null, async (get, _set) => {
            const count = get(this.env.getBlockMetaKeyAtom(blockId, "count")) ?? 0;
            await this.env.rpc.SetMetaCommand(TabRpcClient, {
                oref: makeORef("block", this.blockId),
                meta: { count: count + 1 },
            });
        });
        this.connection = jotai.atom((get) => {
            const connValue = get(this.env.getBlockMetaKeyAtom(blockId, "connection"));
            if (util.isBlank(connValue)) {
                return "local";
            }
            return connValue;
        });
        this.dataAtom = jotai.atom([]);
        this.loadInitialData();
        this.connStatus = jotai.atom((get) => {
            const connName = get(this.env.getBlockMetaKeyAtom(blockId, "connection"));
            const connAtom = this.env.getConnStatusAtom(connName);
            return get(connAtom);
        });
    }

    get viewComponent(): ViewComponent {
        return SysinfoView;
    }

    async loadInitialData() {
        globalStore.set(this.loadingAtom, true);
        try {
            const numPoints = globalStore.get(this.numPoints);
            const connName = globalStore.get(this.connection);
            const initialData = await this.env.rpc.EventReadHistoryCommand(TabRpcClient, {
                event: "sysinfo",
                scope: connName,
                maxitems: numPoints,
            });
            if (initialData == null) {
                return;
            }
            this.getDefaultData();
            const initialDataItems: DataItem[] = initialData.map(convertWaveEventToDataItem).filter(isDataItem);
            // splice the initial data into the default data (replacing the newest points)
            //newData.splice(newData.length - initialDataItems.length, initialDataItems.length, ...initialDataItems);
            globalStore.set(this.addInitialDataAtom, initialDataItems);
        } catch (e) {
            console.log("Error loading initial data for sysinfo", e);
        } finally {
            globalStore.set(this.loadingAtom, false);
        }
    }

    getSelectedMetricKeys(dataItem: DataItem | null): Array<string> {
        const metaMetrics = globalStore.get(this.env.getBlockMetaKeyAtom(this.blockId, "graph:metrics"));
        const plotType = globalStore.get(this.plotTypeSelectedAtom);
        return resolveSelectedMetricKeys(metaMetrics, plotType, dataItem);
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const fullConfig = globalStore.get(this.env.atoms.fullConfigAtom);
        const termThemes = fullConfig?.termthemes ?? {};
        const termThemeKeys = Object.keys(termThemes);
        const plotData = globalStore.get(this.dataAtom);

        termThemeKeys.sort((a, b) => {
            return (termThemes[a]["display:order"] ?? 0) - (termThemes[b]["display:order"] ?? 0);
        });
        const fullMenu: ContextMenuItem[] = [];
        const latestDataItem = plotData[plotData.length - 1];
        const selectedMetrics = this.getSelectedMetricKeys(latestDataItem);
        const submenu = MetricToggles.map((plotType) => {
            const dataTypes = plotType.getMetrics(latestDataItem);
            const checked = dataTypes.length > 0 && dataTypes.every((metric) => selectedMetrics.includes(metric));
            const menuItem: ContextMenuItem = {
                label: plotType.label,
                type: "checkbox",
                checked: checked,
                enabled: dataTypes.length > 0,
                sublabel: dataTypes.length > 0 ? plotType.sublabel : "No data yet",
                click: async () => {
                    const nextMetrics = toggleMetricKeys(selectedMetrics, dataTypes);
                    await this.env.rpc.SetMetaCommand(TabRpcClient, {
                        oref: makeORef("block", this.blockId),
                        meta: { "graph:metrics": nextMetrics },
                    });
                },
            };
            return menuItem;
        });

        fullMenu.push({
            label: "Plots",
            submenu: submenu,
        });
        fullMenu.push({ type: "separator" });
        return fullMenu;
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

const _plotColors = ["#58C142", "#FFC107", "#FF5722", "#2196F3", "#9C27B0", "#00BCD4", "#FFEB3B", "#795548"];

type SysinfoViewProps = {
    blockId: string;
    model: SysinfoViewModel;
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

function SysinfoView({ model, blockId }: SysinfoViewProps) {
    const connName = jotai.useAtomValue(model.connection);
    const lastConnName = React.useRef(connName);
    const connStatus = jotai.useAtomValue(model.connStatus);
    const addContinuousData = jotai.useSetAtom(model.addContinuousDataAtom);
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
        const unsubFn = waveEventSubscribeSingle({
            eventType: "sysinfo",
            scope: connName,
            handler: (event) => {
                const loading = globalStore.get(model.loadingAtom);
                if (loading) {
                    return;
                }
                const dataItem = convertWaveEventToDataItem(event);
                if (dataItem == null) {
                    return;
                }
                const prevData = globalStore.get(model.dataAtom);
                const prevLastTs = prevData[prevData.length - 1]?.ts ?? 0;
                if (dataItem.ts - prevLastTs > 2000) {
                    model.loadInitialData();
                } else {
                    addContinuousData(dataItem);
                }
            },
        });
        console.log("subscribe to sysinfo", connName);
        return () => {
            unsubFn();
        };
    }, [connName, addContinuousData]);
    if (connStatus?.status != "connected") {
        return null;
    }
    if (loading) {
        return null;
    }
    return <SysinfoViewInner key={connStatus?.connection ?? "local"} blockId={blockId} model={model} />;
}

type SingleLinePlotProps = {
    plotData: Array<DataItem>;
    yval: string;
    yvalMeta?: TimeSeriesMeta;
    blockId: string;
    defaultColor: string;
    title?: boolean;
    sparkline?: boolean;
    targetLen: number;
};

function SingleLinePlot({
    plotData,
    yval,
    yvalMeta,
    blockId,
    defaultColor,
    title = false,
    sparkline = false,
    targetLen,
}: SingleLinePlotProps) {
    const containerRef = React.useRef<HTMLInputElement>(null);
    const domRect = useDimensionsWithExistingRef(containerRef, 300);
    const plotHeight = domRect?.height ?? 0;
    const plotWidth = domRect?.width ?? 0;
    const marks: Plot.Markish[] = [];
    const decimalPlaces = yvalMeta?.decimalPlaces ?? 0;
    let color = yvalMeta?.color;
    if (!color) {
        color = defaultColor;
    }
    marks.push(
        () => htl.svg`<defs>
      <linearGradient id="gradient-${blockId}-${yval}" gradientTransform="rotate(90)">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.7" />
        <stop offset="100%" stop-color="${color}" stop-opacity="0" />
      </linearGradient>
	      </defs>`
    );

    marks.push(
        Plot.lineY(plotData, {
            stroke: color,
            strokeWidth: 2,
            x: "ts",
            y: yval,
        })
    );

    // only add the gradient for single items
    marks.push(
        Plot.areaY(plotData, {
            fill: `url(#gradient-${blockId}-${yval})`,
            x: "ts",
            y: yval,
        })
    );
    if (title) {
        marks.push(
            Plot.text([yvalMeta?.name ?? getMetricDisplayName(yval)], {
                frameAnchor: "top-left",
                dx: 4,
                fill: "var(--grey-text-color)",
            })
        );
    }
    const labelY = yvalMeta?.label ?? "?";
    marks.push(
        Plot.ruleX(
            plotData,
            Plot.pointerX({ x: "ts", py: yval, stroke: "var(--grey-text-color)", strokeWidth: 1, strokeDasharray: 2 })
        )
    );
    marks.push(
        Plot.ruleY(
            plotData,
            Plot.pointerX({ px: "ts", y: yval, stroke: "var(--grey-text-color)", strokeWidth: 1, strokeDasharray: 2 })
        )
    );
    marks.push(
        Plot.tip(
            plotData,
            Plot.pointerX({
                x: "ts",
                y: yval,
                fill: "var(--main-bg-color)",
                anchor: "middle",
                dy: -30,
                title: (d) => {
                    const value = Number(d[yval]);
                    const displayValue = Number.isFinite(value) ? value.toFixed(decimalPlaces) : "n/a";
                    return `${dayjs.unix(d.ts / 1000).format("HH:mm:ss")} ${displayValue}${labelY}`;
                },
                textPadding: 3,
            })
        )
    );
    marks.push(
        Plot.dot(
            plotData,
            Plot.pointerX({ x: "ts", y: yval, fill: color, r: 3, stroke: "var(--main-text-color)", strokeWidth: 1 })
        )
    );
    const maxY = resolveDomainBound(yvalMeta?.maxy, plotData[plotData.length - 1]) ?? 100;
    const minY = resolveDomainBound(yvalMeta?.miny, plotData[plotData.length - 1]) ?? 0;
    const maxX = plotData[plotData.length - 1].ts;
    const minX = maxX - targetLen * 1000;
    const plot = Plot.plot({
        axis: !sparkline,
        x: {
            grid: true,
            label: "time",
            tickFormat: (d) => `${dayjs.unix(d / 1000).format("HH:mm:ss")}`,
            domain: [minX, maxX],
        },
        y: { label: labelY, domain: [minY, maxY] },
        width: plotWidth,
        height: plotHeight,
        marks: marks,
    });

    React.useEffect(() => {
        containerRef.current.append(plot);

        return () => {
            plot.remove();
        };
    }, [plot, plotWidth, plotHeight]);

    return <div ref={containerRef} className="min-h-[100px]" />;
}

const SysinfoViewInner = React.memo(({ model }: SysinfoViewProps) => {
    const plotData = jotai.useAtomValue(model.dataAtom);
    const yvals = jotai.useAtomValue(model.metrics);
    const plotMeta = jotai.useAtomValue(model.plotMetaAtom);
    const osRef = React.useRef<OverlayScrollbarsComponentRef>(null);
    const targetLen = jotai.useAtomValue(model.numPoints) + 1;
    let title = false;
    let cols2 = false;
    if (yvals.length > 1) {
        title = true;
    }
    if (yvals.length > 2) {
        cols2 = true;
    }

    return (
        <OverlayScrollbarsComponent
            ref={osRef}
            className="flex flex-col flex-grow mb-0 overflow-y-auto"
            options={{ scrollbars: { autoHide: "leave" } }}
        >
            <div
                className={clsx("w-full h-full grid grid-rows-[repeat(auto-fit,minmax(100px,1fr))] gap-[10px]", {
                    "grid-cols-2": cols2,
                })}
            >
                {plotData &&
                    plotData.length > 0 &&
                    yvals.map((yval, _idx) => {
                        return (
                            <SingleLinePlot
                                key={`plot-${model.blockId}-${yval}`}
                                plotData={plotData}
                                yval={yval}
                                yvalMeta={plotMeta.get(yval)}
                                blockId={model.blockId}
                                defaultColor={"var(--accent-color)"}
                                title={title}
                                targetLen={targetLen}
                            />
                        );
                    })}
            </div>
        </OverlayScrollbarsComponent>
    );
});

export { SysinfoViewModel };
