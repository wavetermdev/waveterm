// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/element/button";
import * as WOS from "@/store/wos";
import { clsx } from "clsx";
import React, { useEffect, useRef } from "react";

import "./tab.less";

interface TabProps {
    id: string;
    active: boolean;
    isBeforeActive: boolean;
    isDragging: boolean;
    onSelect: () => void;
    onClose: () => void;
    onDragStart: (event: MouseEvent) => void;
    onLoaded: () => void;
}

const Tab = React.forwardRef<HTMLDivElement, TabProps>(
    ({ id, active, isBeforeActive, isDragging, onLoaded, onSelect, onClose, onDragStart }, ref) => {
        const [tabData, tabLoading] = WOS.useWaveObjectValue<Tab>(WOS.makeORef("tab", id));
        const name = tabData?.name ?? "...";

        const loadedRef = useRef(false);

        useEffect(() => {
            if (!loadedRef.current) {
                onLoaded();
                loadedRef.current = true;
            }
        }, [onLoaded]);

        return (
            <div
                ref={ref}
                className={clsx("tab", { active, isDragging, "before-active": isBeforeActive })}
                onMouseDown={onDragStart}
                onClick={onSelect}
                data-tab-id={id}
            >
                <div className="name">{name}</div>
                {!isDragging && <div className="vertical-line" />}
                {active && <div className="mask" />}
                <Button className="secondary ghost close" onClick={onClose}>
                    <i className="fa fa-solid fa-xmark" />
                </Button>
            </div>
        );
    }
);

export { Tab };
