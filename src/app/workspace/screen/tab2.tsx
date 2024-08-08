import React, { useRef } from "react";
import cn from "classnames";
import { ActionsIcon, StatusIndicator, CenteredIcon } from "@/common/icons/icons";
import { TabIcon } from "@/elements/tabicon";
import { GlobalModel, Screen } from "@/models";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import * as constants from "@/app/appconst";

import "./tab2.less";

type ScreenTabProps = {
    screen: Screen;
    activeScreenId: string;
    onDragStart: (name: string, ref: React.RefObject<HTMLDivElement>) => void;
    onSwitchScreen: (screenId: string) => void;
};

const ScreenTab: React.FC<ScreenTabProps> = mobxReact.observer(
    ({ screen, activeScreenId, onSwitchScreen, onDragStart }) => {
        const ref = useRef<HTMLDivElement>(null);

        const openScreenSettings = (e: any, screen: Screen): void => {
            e.preventDefault();
            e.stopPropagation();
            mobx.action(() => {
                GlobalModel.screenSettingsModal.set({ sessionId: screen.sessionId, screenId: screen.screenId });
            })();
            GlobalModel.modalsModel.pushModal(constants.SCREEN_SETTINGS);
        };

        const archived = screen.archived.get() ? (
            <i title="archived" className="fa-sharp fa-solid fa-box-archive" />
        ) : null;
        const statusIndicatorLevel = screen.statusIndicator.get();
        const runningCommands = screen.numRunningCmds.get() > 0;

        return (
            <div
                ref={ref}
                data-screenid={screen.screenId}
                className={cn(
                    "screen-tab",
                    { "is-active": activeScreenId == screen.screenId, "is-archived": screen.archived.get() },
                    "color-" + screen.getTabColor()
                )}
                onMouseDown={() => onDragStart(screen.name.get(), ref)}
                onClick={() => onSwitchScreen(screen.screenId)}
                data-screentab-name={screen.name.get()}
            >
                <div className="background"></div>
                <div className="screen-tab-inner">
                    <CenteredIcon className="front-icon">
                        <TabIcon icon={screen.getTabIcon()} color={screen.getTabColor()} />
                    </CenteredIcon>
                    <div className="tab-name truncate">
                        {archived}
                        {screen.name.get()}
                    </div>
                    <div className="end-icons">
                        <StatusIndicator level={statusIndicatorLevel} runningCommands={runningCommands} />
                        <ActionsIcon onClick={(e) => openScreenSettings(e, screen)} />
                    </div>
                </div>
                <div className="vertical-line"></div>
            </div>
        );
    }
);

export { ScreenTab };
