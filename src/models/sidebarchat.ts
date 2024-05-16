import * as mobx from "mobx";
import { Model } from "./model";

type SidebarChatFocus = {
    input: boolean;
    block: boolean;
};

class SidebarChatModel {
    globalModel: Model;
    sidebarChatFocus: SidebarChatFocus;
    cmdAndOutput: CmdAndOutput;

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
        mobx.makeObservable(this, {
            sidebarChatFocus: mobx.observable,
            cmdAndOutput: mobx.observable,
            setFocus: mobx.action,
            resetFocus: mobx.action,
            setCmdAndOutput: mobx.action,
            resetCmdAndOutput: mobx.action,
        });
        this.sidebarChatFocus = {
            input: false,
            block: false,
        };
        this.cmdAndOutput = {
            cmd: "",
            output: "",
            isError: false,
        };
    }

    // block can be the chat-window in terms of focus
    setFocus(section: "input" | "block", focus: boolean): void {
        document.querySelector(".sidebarchat .sidebarchat-input");
        this.sidebarChatFocus[section] = focus;
    }

    getFocus(section?: "input" | "block"): boolean {
        if (section == null) {
            return this.sidebarChatFocus.input || this.sidebarChatFocus.block;
        }
        return this.sidebarChatFocus[section];
    }

    resetFocus(): void {
        this.sidebarChatFocus.input = false;
        this.sidebarChatFocus.block = false;
    }

    setCmdAndOutput(cmd: string, output: string, isError: boolean): void {
        this.cmdAndOutput.cmd = cmd;
        this.cmdAndOutput.output = output;
        this.cmdAndOutput.isError = isError;
    }

    getCmdAndOutput(): CmdAndOutput {
        return {
            cmd: this.cmdAndOutput.cmd,
            output: this.cmdAndOutput.output,
            isError: this.cmdAndOutput.isError,
        };
    }

    resetCmdAndOutput(): void {
        this.cmdAndOutput.cmd = "";
        this.cmdAndOutput.output = "";
        this.cmdAndOutput.isError = false;
    }
}

export { SidebarChatModel };
