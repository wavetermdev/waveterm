import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { If, For, When, Otherwise, Choose } from "tsx-control-statements/components";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner } from "./model";
import * as util from "./util";

type OV<V> = mobx.IObservableValue<V>;

class TosModal extends React.Component<{}, {}> {
    @boundMethod
    acceptTos(): void {
        GlobalCommandRunner.clientAcceptTos();
    }

    render() {
        return (
            <div className={cn("modal tos-modal prompt-modal is-active")}>
                <div className="modal-background" />
                <div className="modal-content">
                    <header>
                        <div className="modal-title">Welcome to [prompt]</div>
                    </header>
                    <div className="inner-content">
                        <div className="content">
                            <p>Thank you for downloading Prompt!</p>
                            <p>
                                Prompt is a new terminal designed to help you save time and organize your command life.
                                Prompt is currently in beta. If you'd like to give feedback, run into problems, have
                                questions, or need help, please join the Prompt{" "}
                                <a target="_blank" href={util.makeExternLink("https://discord.gg/XfvZ334gwU")}>
                                    discord&nbsp;server
                                </a>
                                .
                            </p>
                            <p>
                                Prompt is free to use, no email or registration required (unless you're using the cloud
                                features).
                            </p>
                            <p>
                                <a target="_blank" href={util.makeExternLink("https://www.commandline.dev/tos.html")}>
                                    Full Terms of Service
                                </a>
                            </p>
                        </div>
                    </div>
                    <footer>
                        <div className="flex-spacer" />
                        <div onClick={this.acceptTos} className="button is-prompt-green is-outlined is-small">
                            Accept Terms of Service
                        </div>
                    </footer>
                </div>
            </div>
        );
    }
}

export { TosModal };
