// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/element/tooltip";
import { WaveEnv, WaveEnvSubset, useWaveEnv } from "@/app/waveenv/waveenv";
import { useAtomValue } from "jotai";
import { memo, useCallback } from "react";

type UpdateBannerEnv = WaveEnvSubset<{
    electron: {
        installAppUpdate: WaveEnv["electron"]["installAppUpdate"];
    };
    atoms: {
        updaterStatusAtom: WaveEnv["atoms"]["updaterStatusAtom"];
    };
}>;

function getUpdateStatusMessage(status: string): string {
    switch (status) {
        case "ready":
            return "Update";
        case "downloading":
            return "Downloading";
        case "installing":
            return "Installing";
        default:
            return null;
    }
}

const UpdateStatusBannerComponent = () => {
    const env = useWaveEnv<UpdateBannerEnv>();
    const appUpdateStatus = useAtomValue(env.atoms.updaterStatusAtom);
    const updateStatusMessage = getUpdateStatusMessage(appUpdateStatus);

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
