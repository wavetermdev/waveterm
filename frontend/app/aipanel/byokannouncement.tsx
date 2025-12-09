// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WaveAIModel } from "./waveai-model";

const BYOKAnnouncement = () => {
    const model = WaveAIModel.getInstance();

    const handleOpenConfig = async () => {
        RpcApi.RecordTEventCommand(
            TabRpcClient,
            {
                event: "action:other",
                props: {
                    "action:type": "waveai:configuremodes:panel",
                },
            },
            { noresponse: true }
        );
        await model.openWaveAIConfig();
    };

    const handleViewDocs = () => {
        RpcApi.RecordTEventCommand(
            TabRpcClient,
            {
                event: "action:other",
                props: {
                    "action:type": "waveai:viewdocs:panel",
                },
            },
            { noresponse: true }
        );
    };

    return (
        <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-4 mt-4">
            <div className="flex items-start gap-3">
                <i className="fa fa-key text-blue-400 text-lg mt-0.5"></i>
                <div className="text-left flex-1">
                    <div className="text-blue-400 font-medium mb-1">New: BYOK & Local AI Support</div>
                    <div className="text-secondary text-sm mb-3">
                        Wave AI now supports bring-your-own-key (BYOK) with OpenAI, Google Gemini, Azure, and
                        OpenRouter, plus local models via Ollama, LM Studio, and other OpenAI-compatible providers.
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleOpenConfig}
                            className="border border-blue-400 text-blue-400 hover:bg-blue-500/10 hover:text-blue-300 px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-colors"
                        >
                            Configure AI Modes
                        </button>
                        <a
                            href="https://docs.waveterm.dev/waveai-modes"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={handleViewDocs}
                            className="text-secondary hover:text-primary text-sm cursor-pointer transition-colors flex items-center gap-1"
                        >
                            View Docs <i className="fa fa-external-link text-xs"></i>
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
};

BYOKAnnouncement.displayName = "BYOKAnnouncement";

export { BYOKAnnouncement };
