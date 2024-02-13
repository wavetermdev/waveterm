// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import { If } from "tsx-control-statements/components";

import { ReactComponent as CheckIcon } from "@/assets/icons/line/check.svg";
import { ReactComponent as CopyIcon } from "@/assets/icons/history/copy.svg";

import "./cmdstrcode.less";

class CmdStrCode extends React.Component<
    {
        cmdstr: string;
        onUse: () => void;
        onCopy: () => void;
        isCopied: boolean;
        fontSize: "normal" | "large";
        limitHeight: boolean;
    },
    {}
> {
    @boundMethod
    handleUse(e: any) {
        e.stopPropagation();
        if (this.props.onUse != null) {
            this.props.onUse();
        }
    }

    @boundMethod
    handleCopy(e: any) {
        e.stopPropagation();
        if (this.props.onCopy != null) {
            this.props.onCopy();
        }
    }

    render() {
        let { isCopied, cmdstr, fontSize, limitHeight } = this.props;
        return (
            <div className={cn("cmdstr-code", { "is-large": fontSize == "large" }, { "limit-height": limitHeight })}>
                <If condition={isCopied}>
                    <div key="copied" className="copied-indicator">
                        <div>copied</div>
                    </div>
                </If>
                <div key="use" className="use-button hoverEffect" title="Use Command" onClick={this.handleUse}>
                    <CheckIcon className="icon" />
                </div>
                <div key="code" className="code-div">
                    <code>{cmdstr}</code>
                </div>
                <div key="copy" className="copy-control hoverEffect">
                    <div className="inner-copy" onClick={this.handleCopy} title="copy">
                        <CopyIcon className="icon" />
                    </div>
                </div>
            </div>
        );
    }
}

export { CmdStrCode };
