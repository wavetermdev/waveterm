// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { For } from "tsx-control-statements/components";
import cn from "classnames";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel, GlobalCommandRunner, Session, Screen } from "../../../model/model";
import { renderCmdText } from "../../common/common";
import { ReactComponent as SquareIcon } from "../../assets/icons/tab/square.svg";
import { ReactComponent as ActionsIcon } from "../../assets/icons/tab/actions.svg";
import { ReactComponent as AddIcon } from "../../assets/icons/add.svg";
import * as constants from "../../appconst";
import { Reorder } from "framer-motion";
import { MagicLayout } from "../../magiclayout";

import "../workspace.less";
import "./tabs.less";

dayjs.extend(localizedFormat);

@mobxReact.observer
class ScreenTab extends React.Component<{ screen: Screen; activeScreenId: string; index: number; onSwitchScreen }, {}> {
    tabRefs: { [screenId: string]: React.RefObject<any> } = {};
    dragEndTimeout = null;
    scrollIntoViewTimeout = null;

    componentWillUnmount() {
        if (this.scrollIntoViewTimeout) {
            clearTimeout(this.dragEndTimeout);
        }
    }

    @boundMethod
    handleDragEnd(screenId) {
        if (this.dragEndTimeout) {
            clearTimeout(this.dragEndTimeout);
        }

        // Wait for the animation to complete
        this.dragEndTimeout = setTimeout(() => {
            const tabElement = this.tabRefs[screenId].current;
            const finalTabPosition = tabElement.offsetLeft;

            // Calculate the new index based on the final position
            const newIndex = Math.floor(finalTabPosition / MagicLayout.TabWidth);

            GlobalCommandRunner.screenReorder(screenId, `${newIndex + 1}`);
        }, 100);
    }

    @boundMethod
    openScreenSettings(e: any, screen: Screen): void {
        e.preventDefault();
        e.stopPropagation();
        mobx.action(() => {
            GlobalModel.screenSettingsModal.set({ sessionId: screen.sessionId, screenId: screen.screenId });
        })();
        GlobalModel.modalsModel.pushModal(constants.SCREEN_SETTINGS);
    }

    renderTabIcon = (screen: Screen): React.ReactNode => {
        const tabIcon = screen.getTabIcon();
        if (tabIcon === "default" || tabIcon === "square") {
            return (
                <div className="icon svg-icon">
                    <SquareIcon className="left-icon" />
                </div>
            );
        }
        return (
            <div className="icon fa-icon">
                <i className={`fa-sharp fa-solid fa-${tabIcon}`}></i>
            </div>
        );
    };

    render() {
        let { screen, activeScreenId, index, onSwitchScreen } = this.props;

        let tabIndex = null;
        if (index + 1 <= 9) {
            tabIndex = <div className="tab-index">{renderCmdText(String(index + 1))}</div>;
        }
        let settings = (
            <div onClick={(e) => this.openScreenSettings(e, screen)} title="Actions" className="tab-gear">
                <ActionsIcon className="icon hoverEffect " />
            </div>
        );
        let archived = screen.archived.get() ? (
            <i title="archived" className="fa-sharp fa-solid fa-box-archive" />
        ) : null;

        let webShared = screen.isWebShared() ? (
            <i title="shared to web" className="fa-sharp fa-solid fa-share-nodes web-share-icon" />
        ) : null;

        // Create a ref for the tab if it doesn't exist
        if (!this.tabRefs[screen.screenId]) {
            this.tabRefs[screen.screenId] = React.createRef();
        }

        return (
            <Reorder.Item
                ref={this.tabRefs[screen.screenId]}
                value={screen}
                id={"screen-" + screen.screenId}
                whileDrag={{
                    backgroundColor: "rgba(13, 13, 13, 0.85)",
                }}
                data-screenid={screen.screenId}
                className={cn(
                    "screen-tab",
                    { "is-active": activeScreenId == screen.screenId, "is-archived": screen.archived.get() },
                    "color-" + screen.getTabColor()
                )}
                onPointerDown={() => onSwitchScreen(screen.screenId)}
                onContextMenu={(event) => this.openScreenSettings(event, screen)}
                onDragEnd={() => this.handleDragEnd(screen.screenId)}
            >
                {this.renderTabIcon(screen)}
                <div className="tab-name truncate">
                    {archived}
                    {webShared}
                    {screen.name.get()}
                </div>
                {tabIndex}
                {settings}
            </Reorder.Item>
        );
    }
}

export { ScreenTab };
