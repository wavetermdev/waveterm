// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { For } from "tsx-control-statements/components";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner } from "../../../model/model";
import { Modal, TextField, InputDecoration, Tooltip } from "../elements";
import * as util from "../../../util/util";
import { Screen } from "../../../model/model";
import { ReactComponent as SquareIcon } from "../../assets/icons/tab/square.svg";

import "./tabswitcher.less";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;

type SwitcherDataType = {
    sessionId: string;
    sessionName: string;
    sessionIdx: number;
    screenId: string;
    screenIdx: number;
    screenName: string;
    icon: string;
    color: string;
};

const MaxOptionsToDisplay = 100;

@mobxReact.observer
class TabSwitcherModal extends React.Component<{}, {}> {
    screens: Map<string, OV<string>>[];
    sessions: Map<string, OV<string>>[];
    options: SwitcherDataType[] = [];
    sOptions: OArr<SwitcherDataType> = mobx.observable.array(null, {
        name: "TabSwitcherModal-sOptions",
    });
    focusedIdx: OV<number> = mobx.observable.box(0, { name: "TabSwitcherModal-selectedIdx" });
    activeSessionIdx: number;
    optionRefs = [];
    listWrapperRef = React.createRef<HTMLDivElement>();
    prevFocusedIdx = 0;

    componentDidMount() {
        this.activeSessionIdx = GlobalModel.getActiveSession().sessionIdx.get();
        let oSessions = GlobalModel.sessionList;
        let oScreens = GlobalModel.screenMap;
        oScreens.forEach((oScreen) => {
            if (oScreen == null) {
                return;
            }
            if (oScreen.archived.get()) {
                return;
            }
            // Find the matching session in the observable array
            let foundSession = oSessions.find((s) => {
                return s.sessionId == oScreen.sessionId && !s.archived.get();
            });
            if (!foundSession) {
                return;
            }
            let data: SwitcherDataType = {
                sessionName: foundSession.name.get(),
                sessionId: foundSession.sessionId,
                sessionIdx: foundSession.sessionIdx.get(),
                screenName: oScreen.name.get(),
                screenId: oScreen.screenId,
                screenIdx: oScreen.screenIdx.get(),
                icon: this.getTabIcon(oScreen),
                color: this.getTabColor(oScreen),
            };
            this.options.push(data);
        });

        mobx.action(() => {
            this.sOptions.replace(this.sortOptions(this.options).slice(0, MaxOptionsToDisplay));
        })();

        document.addEventListener("keydown", this.handleKeyDown);
    }

    componentWillUnmount() {
        document.removeEventListener("keydown", this.handleKeyDown);
    }

    componentDidUpdate() {
        let currFocusedIdx = this.focusedIdx.get();

        // Check if selectedIdx has changed
        if (currFocusedIdx !== this.prevFocusedIdx) {
            let optionElement = this.optionRefs[currFocusedIdx]?.current;

            if (optionElement) {
                optionElement.scrollIntoView({ block: "nearest" });
            }

            // Update prevFocusedIdx for the next update cycle
            this.prevFocusedIdx = currFocusedIdx;
        }
        if (currFocusedIdx >= this.sOptions.length && this.sOptions.length > 0) {
            this.setFocusedIndex(this.sOptions.length - 1);
        }
    }

    @boundMethod
    getTabIcon(screen: Screen): string {
        let tabIcon = "default";
        let screenOpts = screen.opts.get();
        if (screenOpts != null && !util.isBlank(screenOpts.tabicon)) {
            tabIcon = screenOpts.tabicon;
        }
        return tabIcon;
    }

    @boundMethod
    getTabColor(screen: Screen): string {
        let tabColor = "default";
        let screenOpts = screen.opts.get();
        if (screenOpts != null && !util.isBlank(screenOpts.tabcolor)) {
            tabColor = screenOpts.tabcolor;
        }
        return tabColor;
    }

    @boundMethod
    handleKeyDown(e) {
        if (e.key === "Escape") {
            this.closeModal();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            let newIndex = this.calculateNewIndex(e.key === "ArrowUp");
            this.setFocusedIndex(newIndex);
        } else if (e.key === "Enter") {
            e.preventDefault();
            this.handleSelect(this.focusedIdx.get());
        }
    }

    @boundMethod
    calculateNewIndex(isUpKey) {
        let currentIndex = this.focusedIdx.get();
        if (isUpKey) {
            return Math.max(currentIndex - 1, 0);
        } else {
            return Math.min(currentIndex + 1, this.sOptions.length - 1);
        }
    }

    @boundMethod
    setFocusedIndex(index) {
        mobx.action(() => {
            this.focusedIdx.set(index);
        })();
    }

    @boundMethod
    closeModal(): void {
        GlobalModel.modalsModel.popModal();
    }

    @boundMethod
    handleSelect(index: number): void {
        const selectedOption = this.sOptions[index];
        if (selectedOption) {
            GlobalCommandRunner.switchScreen(selectedOption.screenId, selectedOption.sessionId);
            this.closeModal();
        }
    }

    @boundMethod
    handleSearch(val: string): void {
        let sOptions: SwitcherDataType[];
        if (val == "") {
            sOptions = this.sortOptions(this.options).slice(0, MaxOptionsToDisplay);
        } else {
            sOptions = this.filterOptions(val);
            sOptions = this.sortOptions(sOptions);
            if (sOptions.length > MaxOptionsToDisplay) {
                sOptions = sOptions.slice(0, MaxOptionsToDisplay);
            }
        }
        mobx.action(() => {
            this.sOptions.replace(sOptions);
            this.focusedIdx.set(0);
        })();
    }

    @mobx.computed
    @boundMethod
    filterOptions(searchInput: string): SwitcherDataType[] {
        let filteredScreens = [];

        for (let i = 0; i < this.options.length; i++) {
            let tab = this.options[i];
            let match = false;

            if (searchInput.includes("/")) {
                let [sessionFilter, screenFilter] = searchInput.split("/").map((s) => s.trim().toLowerCase());
                match =
                    tab.sessionName.toLowerCase().includes(sessionFilter) &&
                    tab.screenName.toLowerCase().includes(screenFilter);
            } else {
                match =
                    tab.sessionName.toLowerCase().includes(searchInput) ||
                    tab.screenName.toLowerCase().includes(searchInput);
            }

            // Add tab to filtered list if it matches the criteria
            if (match) {
                filteredScreens.push(tab);
            }
        }

        return filteredScreens;
    }

    @mobx.computed
    @boundMethod
    sortOptions(options: SwitcherDataType[]): SwitcherDataType[] {
        return options.sort((a, b) => {
            let aInCurrentSession = a.sessionIdx === this.activeSessionIdx;
            let bInCurrentSession = b.sessionIdx === this.activeSessionIdx;

            // Tabs in the current session are sorted by screenIdx
            if (aInCurrentSession && bInCurrentSession) {
                return a.screenIdx - b.screenIdx;
            }
            // a is in the current session and b is not, so a comes first
            else if (aInCurrentSession) {
                return -1;
            }
            // b is in the current session and a is not, so b comes first
            else if (bInCurrentSession) {
                return 1;
            }
            // Both are in different, non-current sessions - sort by sessionIdx and then by screenIdx
            else {
                if (a.sessionIdx === b.sessionIdx) {
                    return a.screenIdx - b.screenIdx;
                } else {
                    return a.sessionIdx - b.sessionIdx;
                }
            }
        });
    }

    @boundMethod
    renderIcon(option: SwitcherDataType): React.ReactNode {
        let tabIcon = option.icon;
        if (tabIcon === "default" || tabIcon === "square") {
            return <SquareIcon className="left-icon" />;
        }
        return <i className={`fa-sharp fa-solid fa-${tabIcon}`}></i>;
    }

    @boundMethod
    renderOption(option: SwitcherDataType, index: number): JSX.Element {
        if (!this.optionRefs[index]) {
            this.optionRefs[index] = React.createRef();
        }
        return (
            <div
                key={option.sessionId + "/" + option.screenId}
                ref={this.optionRefs[index]}
                className={cn("search-option unselectable", {
                    "focused-option": this.focusedIdx.get() === index,
                })}
                onClick={() => this.handleSelect(index)}
            >
                <div className={cn("icon", "color-" + option.color)}>{this.renderIcon(option)}</div>
                <div className="tabname">
                    #{option.sessionName} / {option.screenName}
                </div>
            </div>
        );
    }

    render() {
        let option: SwitcherDataType;
        let index: number;
        return (
            <Modal className="tabswitcher-modal">
                <div className="wave-modal-body">
                    <div className="textfield-wrapper">
                        <TextField
                            onChange={this.handleSearch}
                            maxLength={400}
                            autoFocus={true}
                            decoration={{
                                startDecoration: (
                                    <InputDecoration position="start">
                                        <div className="tabswitcher-search-prefix">Switch to Tab:</div>
                                    </InputDecoration>
                                ),
                                endDecoration: (
                                    <InputDecoration>
                                        <Tooltip
                                            message={`Type to filter workspaces and tabs.`}
                                            icon={<i className="fa-sharp fa-regular fa-circle-question" />}
                                        >
                                            <i className="fa-sharp fa-regular fa-circle-question" />
                                        </Tooltip>
                                    </InputDecoration>
                                ),
                            }}
                        />
                    </div>
                    <div className="list-container">
                        <div ref={this.listWrapperRef} className="list-container-inner">
                            <div className="options-list">
                                <For each="option" index="index" of={this.sOptions}>
                                    {this.renderOption(option, index)}
                                </For>
                            </div>
                        </div>
                    </div>
                </div>
            </Modal>
        );
    }
}

export { TabSwitcherModal };
