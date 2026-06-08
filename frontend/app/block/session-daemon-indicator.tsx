// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveEnv } from "@/app/waveenv/waveenv";
import * as jotai from "jotai";
import { BlockEnv } from "./blockenv";

interface SessionDaemonIndicatorProps {
    blockId: string;
    useTermHeader: boolean;
}

export function SessionDaemonIndicator({ blockId, useTermHeader }: SessionDaemonIndicatorProps) {
    const waveEnv = useWaveEnv<BlockEnv>();
    const daemonId = jotai.useAtomValue(
        waveEnv.getBlockMetaKeyAtom(blockId, "session:daemonid")
    );

    if (!useTermHeader || !daemonId) {
        return null;
    }

    return (
        <div className="iconbutton disabled text-[13px] ml-[-4px]" title={`Session: ${daemonId}`}>
            <i className="fa-sharp fa-solid fa-link text-sky-500" />
        </div>
    );
}
