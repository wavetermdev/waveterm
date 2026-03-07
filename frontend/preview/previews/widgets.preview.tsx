// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WidgetsV } from "@/app/workspace/widgets";
import { useCallback, useState } from "react";

const PreviewWidgets: WidgetConfigType[] = [
    {
        "display:order": 1,
        icon: "sparkles",
        color: "#a78bfa",
        label: "AI",
        description: "Open Wave AI",
        blockdef: { meta: { view: "waveai" } },
    },
    {
        "display:order": 2,
        icon: "terminal",
        color: "#22c55e",
        label: "Terminal",
        description: "Create a terminal block",
        blockdef: { meta: { view: "term" } },
    },
    {
        "display:order": 3,
        icon: "globe",
        color: "#38bdf8",
        label: "Preview",
        description: "Open a web preview",
        blockdef: { meta: { view: "web" } },
    },
    {
        "display:order": 4,
        icon: "chart-line",
        color: "#f97316",
        label: "Sysinfo",
        description: "Open system info",
        blockdef: { meta: { view: "sysinfo" } },
    },
    {
        "display:order": 5,
        icon: "book",
        color: "#facc15",
        label: "Docs",
        description: "Open help docs",
        blockdef: { meta: { view: "help" } },
    },
    {
        "display:order": 6,
        icon: "folder-tree",
        color: "#fb7185",
        label: "Files",
        description: "Open file preview",
        blockdef: { meta: { view: "preview" } },
    },
];

const PreviewApps: AppInfo[] = [
    {
        appid: "local/deploy",
        modtime: 0,
        manifest: { appmeta: { title: "Deploy", shortdesc: "", icon: "rocket", iconcolor: "#f97316" } } as AppManifest,
    },
    {
        appid: "local/notes",
        modtime: 0,
        manifest: { appmeta: { title: "Notes", shortdesc: "", icon: "note-sticky", iconcolor: "#60a5fa" } } as AppManifest,
    },
    {
        appid: "local/status",
        modtime: 0,
        manifest: { appmeta: { title: "Status", shortdesc: "", icon: "chart-line", iconcolor: "#34d399" } } as AppManifest,
    },
    {
        appid: "local/insights",
        modtime: 0,
        manifest: { appmeta: { title: "Insights", shortdesc: "", icon: "chart-pie", iconcolor: "#c084fc" } } as AppManifest,
    },
    {
        appid: "local/pipeline",
        modtime: 0,
        manifest: { appmeta: { title: "Pipeline", shortdesc: "", icon: "cubes", iconcolor: "#f472b6" } } as AppManifest,
    },
    {
        appid: "local/ops",
        modtime: 0,
        manifest: { appmeta: { title: "Ops", shortdesc: "", icon: "server", iconcolor: "#facc15" } } as AppManifest,
    },
];

const PreviewModes: Array<{ title: string; height: number }> = [
    { title: "normal", height: 420 },
    { title: "compact", height: 220 },
    { title: "supercompact", height: 128 },
];

function WidgetsPreviewMode({ title, height }: { title: string; height: number }) {
    const [events, setEvents] = useState<string[]>([]);

    const pushEvent = useCallback((message: string) => {
        setEvents((prev) => [message, ...prev].slice(0, 6));
    }, []);

    const loadApps = useCallback(async () => PreviewApps, []);

    const handleCreateBlock = useCallback(
        (blockDef: BlockDef, magnified?: boolean, ephemeral?: boolean) => {
            const view = blockDef?.meta?.view ?? "unknown";
            pushEvent(`createBlock(${view})${magnified ? " magnified" : ""}${ephemeral ? " ephemeral" : ""}`);
        },
        [pushEvent]
    );

    const handleOpenBuilder = useCallback(() => {
        pushEvent("openBuilder()");
    }, [pushEvent]);

    return (
        <div className="min-w-[280px] flex-1 rounded-lg border border-border bg-panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="font-mono text-sm text-foreground">{title}</div>
                <div className="text-xs text-muted">height: {height}px</div>
            </div>
            <div className="flex items-start gap-4">
                <div className="relative shrink-0 overflow-visible rounded-md border border-border bg-background px-1" style={{ height }}>
                    <WidgetsV
                        widgets={PreviewWidgets}
                        showAppsButton={true}
                        loadApps={loadApps}
                        onCreateBlock={handleCreateBlock}
                        onOpenBuilder={handleOpenBuilder}
                        rootClassName="h-full"
                        className="h-full"
                    />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="mb-2 text-xs text-muted">Open the apps and settings flyouts, then click items to exercise handlers.</p>
                    <div className="rounded-md border border-border bg-background/60 p-3">
                        <div className="mb-2 text-xs font-medium text-secondary">Event log</div>
                        <div className="space-y-1 font-mono text-xs text-foreground">
                            {events.length > 0 ? (
                                events.map((event, idx) => (
                                    <div key={`${event}-${idx}`} className="truncate">
                                        {event}
                                    </div>
                                ))
                            ) : (
                                <div className="text-muted">No interactions yet</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function WidgetsPreview() {
    return (
        <div className="flex w-full max-w-[1400px] flex-col gap-6 px-6">
            <div className="max-w-[900px] text-sm text-muted">
                This preview uses the extracted visual widgets component with mocked apps and block actions so the real
                mode switching and flyout UI can be exercised side-by-side.
            </div>
            <div className="flex w-full gap-4 overflow-x-auto pb-2">
                {PreviewModes.map((mode) => (
                    <WidgetsPreviewMode key={mode.title} title={mode.title} height={mode.height} />
                ))}
            </div>
        </div>
    );
}
