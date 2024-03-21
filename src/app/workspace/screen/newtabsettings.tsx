import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import cn from "classnames";
import { GlobalCommandRunner, GlobalModel, Screen } from "@/models";
import { Button, TextField, Dropdown } from "@/elements";
import { getRemoteStr } from "@/common/prompt/prompt";
import * as util from "@/util/util";
import { TabIcon } from "@/elements/tabicon";
import { ReactComponent as EllipseIcon } from "@/assets/icons/ellipse.svg";
import { ReactComponent as Check12Icon } from "@/assets/icons/check12.svg";
import { ReactComponent as GlobeIcon } from "@/assets/icons/globe.svg";
import { ReactComponent as StatusCircleIcon } from "@/assets/icons/statuscircle.svg";
import * as appconst from "@/app/appconst";

import "./screenview.less";
import "./tabs.less";

@mobxReact.observer
class NewTabSettings extends React.Component<{ screen: Screen }, {}> {
    errorMessage: OV<string | null> = mobx.observable.box(null, { name: "NewTabSettings-errorMessage" });

    constructor(props) {
        super(props);
    }

    @boundMethod
    clickNewConnection(): void {
        GlobalModel.remotesModel.openAddModal({ remoteedit: true });
    }

    render() {
        let { screen } = this.props;
        let rptr = screen.curRemote.get();
        return (
            <div className="newtab-container">
                <div className="newtab-section name-section">
                    <TabNameTextField screen={screen} errorMessage={this.errorMessage} />
                </div>
                <div className="newtab-spacer" />
                <div className="newtab-section conn-section">
                    <div className="unselectable">
                        You're connected to [{getRemoteStr(rptr)}]. Do you want to change it?
                    </div>
                    <div>
                        <TabRemoteSelector screen={screen} errorMessage={this.errorMessage} />
                    </div>
                    <div className="text-caption cr-help-text">
                        To change connection from the command line use `cr [alias|user@host]`
                    </div>
                </div>
                <div className="newtab-spacer" />
                <div className="newtab-section">
                    <TabIconSelector screen={screen} errorMessage={this.errorMessage} />
                </div>
                <div className="newtab-spacer" />
                <div className="newtab-section">
                    <TabColorSelector screen={screen} errorMessage={this.errorMessage} />
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class TabNameTextField extends React.Component<{ screen: Screen; errorMessage?: OV<string> }, {}> {
    @boundMethod
    updateName(val: string): void {
        let { screen } = this.props;
        let prtn = GlobalCommandRunner.screenSetSettings(screen.screenId, { name: val }, false);
        util.commandRtnHandler(prtn, this.props.errorMessage);
    }

    render() {
        let { screen } = this.props;
        return (
            <TextField label="Name" required={true} defaultValue={screen.name.get() ?? ""} onChange={this.updateName} />
        );
    }
}

@mobxReact.observer
class TabColorSelector extends React.Component<{ screen: Screen; errorMessage?: OV<string> }, {}> {
    @boundMethod
    selectTabColor(color: string): void {
        let { screen } = this.props;
        if (screen.getTabColor() == color) {
            return;
        }
        let prtn = GlobalCommandRunner.screenSetSettings(screen.screenId, { tabcolor: color }, false);
        util.commandRtnHandler(prtn, this.props.errorMessage);
    }

    render() {
        let { screen } = this.props;
        let curColor = screen.getTabColor();
        if (util.isBlank(curColor) || curColor == "default") {
            curColor = "green";
        }
        let color: string | null = null;

        return (
            <div>
                <div className="bold unselectable">Tab Color:</div>
                <div className="control-iconlist">
                    <For each="color" of={appconst.TabColors}>
                        <div
                            className="icondiv"
                            key={color}
                            title={color || ""}
                            onClick={() => this.selectTabColor(color || "")}
                        >
                            <EllipseIcon className={cn("icon", "color-" + color)} />
                            <If condition={color == curColor}>
                                <Check12Icon className="check-icon" />
                            </If>
                        </div>
                    </For>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class TabIconSelector extends React.Component<{ screen: Screen; errorMessage?: OV<string> }, {}> {
    @boundMethod
    selectTabIcon(icon: string): void {
        let { screen } = this.props;
        if (screen.getTabIcon() == icon) {
            return;
        }
        let prtn = GlobalCommandRunner.screenSetSettings(screen.screenId, { tabicon: icon }, false);
        util.commandRtnHandler(prtn, this.props.errorMessage);
    }

    render() {
        let { screen } = this.props;
        let curIcon = screen.getTabIcon();
        if (util.isBlank(curIcon) || curIcon == "default") {
            curIcon = "square";
        }
        let icon: string | null = null;
        let curColor = screen.getTabColor();
        return (
            <div>
                <div className="bold unselectable">Tab Icon:</div>
                <div className="control-iconlist tabicon-list">
                    <For each="icon" of={appconst.TabIcons}>
                        <div
                            className="icondiv tabicon"
                            key={icon}
                            title={icon || ""}
                            onClick={() => this.selectTabIcon(icon || "")}
                        >
                            <TabIcon icon={icon} color={curColor} />
                        </div>
                    </For>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class TabRemoteSelector extends React.Component<{ screen: Screen; errorMessage?: OV<string> }, {}> {
    @boundMethod
    selectRemote(cname: string): void {
        let prtn = GlobalCommandRunner.screenSetRemote(cname, true, false);
        util.commandRtnHandler(prtn, this.props.errorMessage);
    }

    @boundMethod
    getOptions(): { label: string; value: string }[] {
        let remotes = GlobalModel.remotes;
        return remotes
            .filter((r) => !r.archived)
            .map((remote) => ({
                ...remote,
                label: !util.isBlank(remote.remotealias)
                    ? `${remote.remotealias} - ${remote.remotecanonicalname}`
                    : remote.remotecanonicalname,
                value: remote.remotecanonicalname,
            }))
            .sort((a, b) => {
                let connValA = util.getRemoteConnVal(a);
                let connValB = util.getRemoteConnVal(b);
                if (connValA !== connValB) {
                    return connValA - connValB;
                }
                return a.remoteidx - b.remoteidx;
            });
    }

    render() {
        let { screen } = this.props;
        let curRemote = GlobalModel.getRemote(screen.getCurRemoteInstance().remoteid);
        return (
            <Dropdown
                className="conn-dropdown"
                options={this.getOptions()}
                defaultValue={curRemote.remotecanonicalname}
                onChange={this.selectRemote}
                decoration={{
                    startDecoration: (
                        <div className="lefticon">
                            <GlobeIcon className="globe-icon" />
                            <StatusCircleIcon className={cn("status-icon", "status-" + curRemote.status)} />
                        </div>
                    ),
                }}
            />
        );
    }
}

export { NewTabSettings };
