// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { GlobalModel } from "../../../model/model";
import { isBlank } from "../../../util/util";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";
import { Prompt } from "../../common/prompt/prompt";
import { TextAreaInput } from "./textareainput";
import { If, For } from "tsx-control-statements/components";

@mobxReact.observer
class AIChat extends React.Component<{}, {}> {

    componentDidMount() {
    }       

    @boundMethod
    handleInnerHeightUpdate(): void {
    }

    @mobx.action
    @boundMethod
    onKeyDown(e: any) {
        console.log("mk1");
        let model = GlobalModel;
        let inputModel = model.inputModel;
        let ctrlMod = e.getModifierState("Control") || e.getModifierState("Meta") || e.getModifierState("Shift");

        if (e.code == "Enter") {
            console.log("hello");
            e.preventDefault();
            if (!ctrlMod) { 
                inputModel.addAIChatMessage(e.target.value);
                console.log("target value?:", e.target.value);
                e.target.value = "";
                return;
            }
            e.target.setRangeText("\n", e.target.selectionStart, e.target.selectionEnd, "end");
            console.log("shift enter - target value: ", e.target.value);
            return;
        }            
    }
    
    /*
    
    renderChatMessage(messageStr: string): any {
        return(
            <div key={messageStr}>
                {messageStr}
            </div>
        );

    }
    
    renderChatWindow(): any { 
        let model = GlobalModel;
        let inputModel = model.inputModel;
        let chatMessageItems = inputModel.AIChatItems;
        let chitem: string = null;
        return (
            <div> 
                <For each="chitem" index="idx" of={chatMessageItems}>
                    {this.renderChatMessage(chitem)}
                </For>
            </div>
        );

    }
    */

    render() {
        let model = GlobalModel;
        let inputModel = model.inputModel;

        let displayLines = 1;
        let termFontSize = 14;
        // fontSize*1.5 (line-height) + 2 * 0.5em padding
        let computedInnerHeight = displayLines * (termFontSize * 1.5) + 2 * 0.5 * termFontSize;
        // inner height + 2*1em padding
        let computedOuterHeight = computedInnerHeight + 2 * 1.0 * termFontSize;
        return (
            <div className = "cmd-input-field">
                <div className="control is-expanded" style={{ height: computedOuterHeight }} >
                    <textarea
                        key="main"
                        autoComplete="off"
                        autoCorrect="off"
                        id="main-cmd-input"
                        onKeyDown={this.onKeyDown}
                        style={{ height: computedInnerHeight, minHeight: computedInnerHeight, fontSize: termFontSize }}
                        className={cn("textarea")}
                    ></textarea>
                </div>
            </div>

        );
    }
    
    
}

export {AIChat}
