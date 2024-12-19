// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from "react";
import "./tabs.scss";

type Tab = {
    label: string;
    onClick: () => void;
};

type TabsProps = {
    tabs: Tab[];
};

const Tabs: React.FC<TabsProps> = ({ tabs }) => {
    const [activeIndex, setActiveIndex] = useState(0);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, index: number) => {
        if (event.key === "ArrowRight") {
            setActiveIndex((prevIndex) => (prevIndex + 1) % tabs.length);
        } else if (event.key === "ArrowLeft") {
            setActiveIndex((prevIndex) => (prevIndex - 1 + tabs.length) % tabs.length);
        } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            tabs[index].onClick();
            setActiveIndex(index);
        }
    };

    return (
        <div className="tabs-container">
            <div className="tabs-list" role="tablist">
                {tabs.map((tab, index) => (
                    <div
                        key={index}
                        role="tab"
                        tabIndex={activeIndex === index ? 0 : -1}
                        aria-selected={activeIndex === index}
                        className={`tab-item ${activeIndex === index ? "active" : ""}`}
                        onClick={() => {
                            tab.onClick();
                            setActiveIndex(index);
                        }}
                        onKeyDown={(e) => handleKeyDown(e, index)}
                    >
                        {tab.label}
                    </div>
                ))}
            </div>
        </div>
    );
};

export { Tabs };
