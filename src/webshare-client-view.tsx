import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {v4 as uuidv4} from "uuid";
import dayjs from "dayjs";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames";
import {GlobalModel, GlobalCommandRunner} from "./model";

@mobxReact.observer
class WebShareView extends React.Component<{}, {}> {
    @boundMethod
    closeView() : void {
        GlobalModel.showSessionView();
    }
    
    render() {
        let isHidden = (GlobalModel.activeMainView.get() != "bookmarks");
        if (isHidden) {
            return null;
        }
        return (
            <div className={cn("webshare-view", "alt-view")}>
            </div>
        );
    }
}

export {WebShareView};

