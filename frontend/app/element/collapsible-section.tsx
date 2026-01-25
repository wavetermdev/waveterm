// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, ReactNode } from "react";

import "./collapsible-section.scss";

interface CollapsibleSectionProps {
    title: string;
    icon?: string;
    isExpanded: boolean;
    onToggle: () => void;
    badge?: ReactNode;
    children: ReactNode;
}

export const CollapsibleSection = memo(
    ({ title, icon, isExpanded, onToggle, badge, children }: CollapsibleSectionProps) => {
        return (
            <div className={cn("collapsible-section", { expanded: isExpanded })}>
                <button className="section-header" onClick={onToggle} aria-expanded={isExpanded}>
                    {icon && (
                        <span className="section-icon">
                            <i className={`fa fa-solid fa-${icon}`} />
                        </span>
                    )}
                    <span className="section-title">{title}</span>
                    {badge && <span className="section-badge">{badge}</span>}
                    <span className={cn("section-chevron", { expanded: isExpanded })}>
                        <i className="fa fa-solid fa-chevron-right" />
                    </span>
                </button>
                <div className={cn("section-content", { expanded: isExpanded })}>
                    <div className="section-inner">{children}</div>
                </div>
            </div>
        );
    }
);

CollapsibleSection.displayName = "CollapsibleSection";
