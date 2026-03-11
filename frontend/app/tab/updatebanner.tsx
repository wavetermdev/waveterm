// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/element/tooltip";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { TabBarEnv } from "./tabbarenv";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useState } from "react";

const UpdateStatusBannerComponent = () => {
    const env = useWaveEnv<TabBarEnv>();
    const appUpdateStatus = useAtomValue(env.atoms.updaterStatusAtom);
    const [updateStatusMessage, setUpdateStatusMessage] = useState<string>();
    const [dismissBannerTimeout, setDismissBannerTimeout] = useState<NodeJS.Timeout>();

    useEffect(() => {
        let message: string;
        const dismissBanner = false;
        switch (appUpdateStatus) {
            case "ready":
                message = "Update";
                break;
            case "downloading":
                message = "Downloading";
                break;
            case "installing":
                message = "Installing";
                break;
            default:
                break;
        }
        setUpdateStatusMessage(message);

        // Clear any existing timeout
        if (dismissBannerTimeout) {
            clearTimeout(dismissBannerTimeout);
        }

        // If we want to dismiss the banner, set the new timeout, otherwise clear the state
        if (dismissBanner) {
            setDismissBannerTimeout(
                setTimeout(() => {
                    setUpdateStatusMessage(null);
                    setDismissBannerTimeout(null);
                }, 10000)
            );
        } else {
            setDismissBannerTimeout(null);
        }
    }, [appUpdateStatus]);

    const onClick = useCallback(() => {
        env.electron.installAppUpdate();
    }, [env]);

    if (!updateStatusMessage) {
        return null;
    }

    const isReady = appUpdateStatus === "ready";
    const tooltipContent = isReady ? "Click to Install Update" : updateStatusMessage;

    return (
        <Tooltip
            content={tooltipContent}
            placement="bottom"
            divOnClick={isReady ? onClick : undefined}
            divClassName={`flex items-center gap-1 px-2 mb-1 h-[22px] text-xs font-medium text-black bg-accent rounded-sm transition-all ${isReady ? "cursor-pointer hover:bg-[var(--button-green-border-color)]" : ""}`}
            divStyle={{ WebkitAppRegion: "no-drag" } as any}
        >
            <i className="fa fa-download" />
            {updateStatusMessage}
        </Tooltip>
    );
};
UpdateStatusBannerComponent.displayName = "UpdateStatusBannerComponent";

export const UpdateStatusBanner = memo(UpdateStatusBannerComponent);
