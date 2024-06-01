import * as mobx from "mobx";
import { Model } from "./model";

class SidebarChatModel {
    globalModel: Model;
    sidebarChatFocused: OV<boolean> = mobx.observable.box(false, { name: "SidebarChatModel-sidebarChatFocused" });
    cmdAndOutput: OV<{ cmd: string; output: string; usedRows: number; isError: boolean }> = mobx.observable.box(
        { cmd: "", output: "", usedRows: 0, isError: false },
        { name: "SidebarChatModel-cmdAndOutput" }
    );
    cmdFromChat: OV<string> = mobx.observable.box("", { name: "SidebarChatModel-cmdFromChat" });

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
        mobx.makeObservable(this);
    }

    // block can be the chat-window in terms of focus
    @mobx.action
    setFocus(focus: boolean): void {
        this.resetFocus();
        this.sidebarChatFocused.set(focus);
    }

    hasFocus(): boolean {
        return this.sidebarChatFocused.get();
    }

    @mobx.action
    resetFocus(): void {
        this.sidebarChatFocused.set(false);
    }

    @mobx.action
    setCmdAndOutput(cmd: string, output: string, usedRows: number, isError: boolean): void {
        console.log("cmd", cmd);
        this.cmdAndOutput.set({
            cmd: cmd,
            output: output,
            usedRows: usedRows,
            isError: isError,
        });
    }

    getCmdAndOutput(): { cmd: string; output: string; usedRows: number; isError: boolean } {
        return this.cmdAndOutput.get();
    }

    @mobx.action
    resetCmdAndOutput(): void {
        this.cmdAndOutput.set({
            cmd: "",
            output: "",
            usedRows: 0,
            isError: false,
        });
    }

    hasCmdAndOutput(): boolean {
        const { cmd, output } = this.cmdAndOutput.get();
        return cmd.length > 0 || output.length > 0;
    }

    @mobx.action
    setCmdToExec(cmd: string): void {
        this.cmdFromChat.set(cmd);
    }

    @mobx.action
    resetCmdToExec(): void {
        this.cmdFromChat.set("");
    }

    getCmdToExec(): string {
        return this.cmdFromChat.get();
    }
}

export { SidebarChatModel };
