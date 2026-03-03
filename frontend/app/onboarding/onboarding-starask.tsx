// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { Button } from "@/app/element/button";
import { ClientModel } from "@/app/store/client-model";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

type StarAskPageProps = {
    onClose: () => void;
    page?: string;
};

export function StarAskPage({ onClose, page = "upgrade" }: StarAskPageProps) {
    const handleStarClick = async () => {
        RpcApi.RecordTEventCommand(
            TabRpcClient,
            {
                event: "onboarding:githubstar",
                props: { "onboarding:githubstar": "star", "onboarding:page": page },
            },
            { noresponse: true }
        );
        const clientId = ClientModel.getInstance().clientId;
        await RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("client", clientId),
            meta: { "onboarding:githubstar": true },
        });
        window.open(`https://github.com/wavetermdev/waveterm?ref=${page}`, "_blank");
        onClose();
    };

    const handleAlreadyStarred = async () => {
        RpcApi.RecordTEventCommand(
            TabRpcClient,
            {
                event: "onboarding:githubstar",
                props: { "onboarding:githubstar": "already", "onboarding:page": page },
            },
            { noresponse: true }
        );
        const clientId = ClientModel.getInstance().clientId;
        await RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("client", clientId),
            meta: { "onboarding:githubstar": true },
        });
        onClose();
    };

    const handleRepoLinkClick = () => {
        RpcApi.RecordTEventCommand(
            TabRpcClient,
            {
                event: "action:link",
                props: { "action:type": "githubrepo", "onboarding:page": page },
            },
            { noresponse: true }
        );
        window.open("https://github.com/wavetermdev/waveterm", "_blank");
    };

    const handleMaybeLater = async () => {
        RpcApi.RecordTEventCommand(
            TabRpcClient,
            {
                event: "onboarding:githubstar",
                props: { "onboarding:githubstar": "later", "onboarding:page": page },
            },
            { noresponse: true }
        );
        const clientId = ClientModel.getInstance().clientId;
        await RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("client", clientId),
            meta: { "onboarding:githubstar": false },
        });
        onClose();
    };

    return (
        <div className="flex flex-col h-full">
            <header className="flex flex-col gap-2 border-b-0 p-0 mt-1 mb-6 w-full unselectable flex-shrink-0">
                <div className="flex justify-center">
                    <Logo />
                </div>
                <div className="text-center text-[25px] font-normal text-foreground">Support open-source. Star Wave. ⭐</div>
            </header>
            <div className="flex-1 flex flex-col items-center justify-center gap-5 unselectable">
                <div className="flex flex-col items-center gap-4 max-w-[460px] text-center">
                    <div className="text-secondary text-sm leading-relaxed">
                        Wave is free, open-source, and open-model. Stars help us stay visible against closed
                        alternatives. One click makes a difference.
                    </div>
                    <div
                        className="group flex items-center justify-center gap-2 text-secondary text-sm mt-1 cursor-pointer transition-colors"
                        onClick={handleRepoLinkClick}
                    >
                        <i className="fa-brands fa-github text-foreground text-lg group-hover:text-accent transition-colors" />
                        <span className="text-foreground font-mono text-sm group-hover:text-accent group-hover:underline transition-colors">
                            wavetermdev/waveterm
                        </span>
                    </div>
                </div>
            </div>
            <footer className="unselectable flex-shrink-0 mt-6">
                <div className="flex flex-row items-center justify-center gap-2.5 [&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm [&>button]:!h-[37px]">
                    <Button className="outlined grey font-[600]" onClick={handleAlreadyStarred}>
                        🙏 Already Starred
                    </Button>
                    <Button className="outlined green font-[600]" onClick={handleStarClick}>
                        ⭐ Star Now
                    </Button>
                    <Button className="outlined grey font-[600]" onClick={handleMaybeLater}>
                        Maybe Later
                    </Button>
                </div>
            </footer>
        </div>
    );
}

