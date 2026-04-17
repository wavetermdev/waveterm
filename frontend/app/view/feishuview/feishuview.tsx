// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { uxCloseBlock } from "@/app/store/keymodel";
import { useWaveEnv, type WaveEnv } from "@/app/waveenv/waveenv";
import { fireAndForget } from "@/util/util";
import { atom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";

const FeishuWebUrl = "https://www.feishu.cn/messenger/";

class FeishuViewModel implements ViewModel {
    blockId: string;
    env: WaveEnv;
    viewType = "feishu";
    viewIcon = atom("desktop");
    viewName = atom("Feishu App");
    noPadding = atom(true);
    viewComponent = FeishuAppView;

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.env = waveEnv;
    }
}

function FeishuAppView({ blockId }: ViewComponentProps<FeishuViewModel>) {
    const env = useWaveEnv<WaveEnv>();
    const [launching, setLaunching] = useState(true);
    const [launchResult, setLaunchResult] = useState<OpenFeishuResult | null>(null);

    const openLocalApp = useCallback(() => {
        fireAndForget(async () => {
            setLaunching(true);
            try {
                const result = await env.electron.openFeishuApp();
                setLaunchResult(result);
            } finally {
                setLaunching(false);
            }
        });
    }, [env]);

    const openWebView = useCallback(() => {
        fireAndForget(() =>
            env.createBlock({
                meta: {
                    view: "feishuweb",
                },
            })
        );
    }, [env]);

    useEffect(() => {
        openLocalApp();
    }, [openLocalApp]);

    const title = useMemo(() => {
        if (launching) {
            return "正在打开本地飞书 App…";
        }
        if (launchResult?.opened) {
            return "本地飞书 App 已打开";
        }
        return "未检测到可用的本地飞书 App";
    }, [launching, launchResult]);

    const detail = useMemo(() => {
        if (launching) {
            return "这个入口只负责打开本地飞书。如果你想在 Wave 里直接聊天，请使用 Feishu Web。";
        }
        if (launchResult?.opened) {
            const methodText = launchResult.method ? `启动方式：${launchResult.method}` : null;
            const appPathText = launchResult.appPath ? `应用路径：${launchResult.appPath}` : null;
            return [methodText, appPathText, "如果想在 Wave 里直接使用聊天页，请打开 Feishu Web。"]
                .filter(Boolean)
                .join("  ·  ");
        }
        return "你可以配置 `feishu:apppath` 指定安装路径，或者直接打开 Feishu Web。";
    }, [launching, launchResult]);

    return (
        <div className="flex h-full w-full items-center justify-center bg-panel px-6 py-8">
            <div className="flex w-full max-w-[760px] flex-col rounded-xl border border-border bg-background px-8 py-7 shadow-lg">
                <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/5 text-2xl text-white/90">
                        <i className="fa fa-solid fa-desktop"></i>
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-lg font-semibold text-primary">{title}</div>
                        <div className="mt-2 text-sm leading-6 text-secondary">{detail}</div>
                    </div>
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                    <Button className="green" onClick={openLocalApp} disabled={launching}>
                        {launching ? "正在打开…" : "重新打开本地飞书"}
                    </Button>
                    <Button className="outline grey" onClick={openWebView}>
                        打开 Feishu Web
                    </Button>
                    <Button className="outline grey" onClick={() => env.electron.openExternal(FeishuWebUrl)}>
                        浏览器打开飞书
                    </Button>
                    <Button className="outline grey" onClick={() => uxCloseBlock(blockId)}>
                        隐藏卡片
                    </Button>
                </div>
            </div>
        </div>
    );
}

export { FeishuViewModel };
