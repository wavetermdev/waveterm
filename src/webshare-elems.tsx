import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames";
import {WebShareModel} from "./webshare-model";

@mobxReact.observer
class WebShareMain extends React.Component<{}, {}> {
    renderCopy() {
        return (<div>&copy; 2023 Dashborg Inc</div>);
    }
            
    render() {
        return (
            <div id="main">
                <div className="logo-header">
                    <div className="logo-text">[prompt]</div>
                    <div className="flex-spacer"/>
                    <a href="https://getprompt.dev/download/" target="_blank" className="download-button button is-link">
                        <span>Download Prompt</span>
                        <span className="icon is-small">
                            <i className="fa-sharp fa-solid fa-cloud-arrow-down"/>
                        </span>
                    </a>
                </div>
                <div className="prompt-content">
                    <div>screenid={WebShareModel.screenId}, viewkey={WebShareModel.viewKey}</div>
                    <div>{WebShareModel.errMessage.get()}</div>
                </div>
                <div className="prompt-footer">
                    {this.renderCopy()}
                    <div className="flex-spacer"/>
                    <a target="_blank" href="https://discord.gg/XfvZ334gwU" className="button is-link is-small">
                        <span className="icon is-small">
                            <i className="fa-brands fa-discord"/>
                        </span>
                        <span>Discord</span>
                    </a>
                </div>
            </div>
        );
    }
}

export {WebShareMain};
