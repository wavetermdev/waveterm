// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner } from "../../../model/model_old";
import { MagicLayout } from "../../magiclayout";

import "./resizablesidebar.less";

type OV<V> = mobx.IObservableValue<V>;

interface ResizableSidebarProps {
    parentRef: React.RefObject<HTMLElement>;
    position: "left" | "right";
    enableSnap?: boolean;
    className?: string;
    children?: (toggleCollapsed: () => void) => React.ReactNode;
    toggleCollapse?: () => void;
}

@mobxReact.observer
class ResizableSidebar extends React.Component<ResizableSidebarProps> {
    resizeStartWidth: number = 0;
    startX: number = 0;
    prevDelta: number = 0;
    prevDragDirection: string = null;
    disposeReaction: any;

    @boundMethod
    startResizing(event: React.MouseEvent<HTMLDivElement>) {
        event.preventDefault();

        const { parentRef, position } = this.props;
        const parentRect = parentRef.current?.getBoundingClientRect();

        if (!parentRect) return;

        if (position === "right") {
            this.startX = parentRect.right - event.clientX;
        } else {
            this.startX = event.clientX - parentRect.left;
        }

        const mainSidebarModel = GlobalModel.mainSidebarModel;
        const collapsed = mainSidebarModel.getCollapsed();

        this.resizeStartWidth = mainSidebarModel.getWidth();
        document.addEventListener("mousemove", this.onMouseMove);
        document.addEventListener("mouseup", this.stopResizing);

        document.body.style.cursor = "col-resize";
        mobx.action(() => {
            mainSidebarModel.setTempWidthAndTempCollapsed(this.resizeStartWidth, collapsed);
            mainSidebarModel.isDragging.set(true);
        })();
    }

    @boundMethod
    onMouseMove(event: MouseEvent) {
        event.preventDefault();

        const { parentRef, enableSnap, position } = this.props;
        const parentRect = parentRef.current?.getBoundingClientRect();
        const mainSidebarModel = GlobalModel.mainSidebarModel;

        if (!mainSidebarModel.isDragging.get() || !parentRect) return;

        let delta: number, newWidth: number;

        if (position === "right") {
            delta = parentRect.right - event.clientX - this.startX;
        } else {
            delta = event.clientX - parentRect.left - this.startX;
        }

        newWidth = this.resizeStartWidth + delta;

        if (enableSnap) {
            const minWidth = MagicLayout.MainSidebarMinWidth;
            const snapPoint = minWidth + MagicLayout.MainSidebarSnapThreshold;
            const dragResistance = MagicLayout.MainSidebarDragResistance;
            let dragDirection: string;

            if (delta - this.prevDelta > 0) {
                dragDirection = "+";
            } else if (delta - this.prevDelta == 0) {
                if (this.prevDragDirection == "+") {
                    dragDirection = "+";
                } else {
                    dragDirection = "-";
                }
            } else {
                dragDirection = "-";
            }

            this.prevDelta = delta;
            this.prevDragDirection = dragDirection;

            if (newWidth - dragResistance > minWidth && newWidth < snapPoint && dragDirection == "+") {
                newWidth = snapPoint;
                mainSidebarModel.setTempWidthAndTempCollapsed(newWidth, false);
            } else if (newWidth + dragResistance < snapPoint && dragDirection == "-") {
                newWidth = minWidth;
                mainSidebarModel.setTempWidthAndTempCollapsed(newWidth, true);
            } else if (newWidth > snapPoint) {
                mainSidebarModel.setTempWidthAndTempCollapsed(newWidth, false);
            }
        } else {
            if (newWidth <= MagicLayout.MainSidebarMinWidth) {
                mainSidebarModel.setTempWidthAndTempCollapsed(newWidth, true);
            } else {
                mainSidebarModel.setTempWidthAndTempCollapsed(newWidth, false);
            }
        }
    }

    @boundMethod
    stopResizing() {
        let mainSidebarModel = GlobalModel.mainSidebarModel;

        GlobalCommandRunner.clientSetSidebar(
            mainSidebarModel.tempWidth.get(),
            mainSidebarModel.tempCollapsed.get()
        ).finally(() => {
            mobx.action(() => {
                mainSidebarModel.isDragging.set(false);
            })();
        });

        document.removeEventListener("mousemove", this.onMouseMove);
        document.removeEventListener("mouseup", this.stopResizing);
        document.body.style.cursor = "";
    }

    @boundMethod
    toggleCollapsed() {
        const mainSidebarModel = GlobalModel.mainSidebarModel;

        const tempCollapsed = mainSidebarModel.getCollapsed();
        const width = mainSidebarModel.getWidth(true);
        mainSidebarModel.setTempWidthAndTempCollapsed(width, !tempCollapsed);
        GlobalCommandRunner.clientSetSidebar(width, !tempCollapsed);
    }

    render() {
        const { className, children } = this.props;
        const mainSidebarModel = GlobalModel.mainSidebarModel;
        const width = mainSidebarModel.getWidth();
        const isCollapsed = mainSidebarModel.getCollapsed();

        return (
            <div className={cn("sidebar", className, { collapsed: isCollapsed })} style={{ width }}>
                <div className="sidebar-content">{children(this.toggleCollapsed)}</div>
                <div
                    className="sidebar-handle"
                    style={{
                        [this.props.position === "left" ? "right" : "left"]: 0,
                    }}
                    onMouseDown={this.startResizing}
                    onDoubleClick={this.toggleCollapsed}
                ></div>
            </div>
        );
    }
}

export { ResizableSidebar };
