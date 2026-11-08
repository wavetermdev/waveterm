// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CSSProperties, useEffect, useState } from "react";

type NodeBackdropsProps = {
    blockBlur: number;
    ephemeralNodeId?: string;
    magnifiedNodeId?: string;
    onMagnifyToggle: (nodeId: string) => void;
    onCloseEphemeral: (nodeId: string) => void;
};

export function NodeBackdrops({
    blockBlur,
    ephemeralNodeId,
    magnifiedNodeId,
    onMagnifyToggle,
    onCloseEphemeral,
}: NodeBackdropsProps) {
    const [showMagnifiedBackdrop, setShowMagnifiedBackdrop] = useState(!!magnifiedNodeId);

    useEffect(() => {
        if (!magnifiedNodeId) {
            setShowMagnifiedBackdrop(false);
            return;
        }
        if (showMagnifiedBackdrop) {
            return;
        }
        const timer = setTimeout(() => setShowMagnifiedBackdrop(true), 100);
        return () => clearTimeout(timer);
    }, [magnifiedNodeId, showMagnifiedBackdrop]);

    const backdropStyle = { "--block-blur": `${blockBlur}px` } as CSSProperties;

    return (
        <>
            {magnifiedNodeId && showMagnifiedBackdrop && (
                <div
                    className="magnified-node-backdrop"
                    onClick={() => onMagnifyToggle(magnifiedNodeId)}
                    style={backdropStyle}
                />
            )}
            {ephemeralNodeId && (
                <div
                    className="ephemeral-node-backdrop"
                    onClick={() => onCloseEphemeral(ephemeralNodeId)}
                    style={backdropStyle}
                />
            )}
        </>
    );
}
