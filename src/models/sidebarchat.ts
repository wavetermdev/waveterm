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
    cmdFromChat: string;

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
        mobx.makeObservable(this, {
            sidebarChatFocus: mobx.observable,
            cmdAndOutput: mobx.observable,
            setFocus: mobx.action,
            resetFocus: mobx.action,
            setCmdAndOutput: mobx.action,
            resetCmdAndOutput: mobx.action,
            setCmdToExec: mobx.action,
            resetCmdToExec: mobx.action,
            hasFocus: mobx.computed,
            focused: mobx.computed,
            cmdToExec: mobx.computed,
        });
        this.sidebarChatFocus = {
            input: false,
            block: false,
        };
        this.cmdAndOutput = {
            cmd: "",
            output: "",
            usedRows: 0,
            isError: false,
        };
        this.cmdFromChat = "";
    }

    // block can be the chat-window in terms of focus
    setFocus(section: "input" | "block", focus: boolean): void {
        document.querySelector(".sidebarchat .sidebarchat-input");
        this.resetFocus();
        this.sidebarChatFocus[section] = focus;
    }

    get hasFocus(): boolean {
        return this.sidebarChatFocus.input || this.sidebarChatFocus.block;
    }

    get focused(): "input" | "block" | null {
        if (this.sidebarChatFocus.input) return "input";
        if (this.sidebarChatFocus.block) return "block";
        return null;
    }

    resetFocus(): void {
        this.sidebarChatFocus.input = false;
        this.sidebarChatFocus.block = false;
    }

    setCmdAndOutput(cmd: string, output: string, usedRows: number, isError: boolean): void {
        this.cmdAndOutput.cmd = cmd;
        this.cmdAndOutput.output = output;
        this.cmdAndOutput.usedRows = usedRows;
        this.cmdAndOutput.isError = isError;
    }

    getCmdAndOutput(): CmdAndOutput {
        return {
            cmd: this.cmdAndOutput.cmd,
            output: this.cmdAndOutput.output,
            usedRows: this.cmdAndOutput.usedRows,
            isError: this.cmdAndOutput.isError,
        };
    }

    resetCmdAndOutput(): void {
        this.cmdAndOutput.cmd = "";
        this.cmdAndOutput.output = "";
        this.cmdAndOutput.usedRows = 0;
        this.cmdAndOutput.isError = false;
    }

    hasCmdAndOutput(): boolean {
        return this.cmdAndOutput.cmd.length > 0 || this.cmdAndOutput.output.length > 0;
    }

    setCmdToExec(cmd: string): void {
        this.cmdFromChat = cmd;
    }

    resetCmdToExec(): void {
        this.cmdFromChat = "";
    }

    get cmdToExec(): string {
        return this.cmdFromChat;
    }
}

export { SidebarChatModel };
