// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { If } from "tsx-control-statements/components";
import { GlobalModel } from "@/models";
import { termHeightFromRows } from "@/util/textmeasure";
import cn from "classnames";
import * as lineutil from "@/app/line/lineutil";

import "./terminal.less";

dayjs.extend(localizedFormat);

class TerminalKeybindings extends React.PureComponent<{ termWrap: any; lineid: string }, {}> {
    componentDidMount(): void {
        this.registerKeybindings();
    }

    registerKeybindings() {
        const keybindManager = GlobalModel.keybindManager;
        const domain = "line-" + this.props.lineid;
        const termWrap = this.props.termWrap;
        keybindManager.registerKeybinding("plugin", domain, "terminal:copy", (waveEvent) => {
            const termWrap = this.props.termWrap;
            const sel = termWrap.terminal.getSelection();
            navigator.clipboard.writeText(sel);
            return true;
        });
        keybindManager.registerKeybinding("plugin", domain, "terminal:paste", (waveEvent) => {
            const p = navigator.clipboard.readText();
            p.then((text) => {
                termWrap.dataHandler?.(text, termWrap);
            });
            return true;
        });
        keybindManager.registerKeybinding("plugin", domain, "generic:selectAbove", (waveEvent) => {
            termWrap.terminal.scrollLines(-1);
            return true;
        });
        keybindManager.registerKeybinding("plugin", domain, "generic:selectBelow", (waveEvent) => {
            termWrap.terminal.scrollLines(1);
            return true;
        });
        keybindManager.registerKeybinding("plugin", domain, "generic:selectPageAbove", (waveEvent) => {
            termWrap.terminal.scrollLines(-10);
            return true;
        });
        keybindManager.registerKeybinding("plugin", domain, "generic:selectPageBelow", (waveEvent) => {
            termWrap.terminal.scrollLines(10);
            return true;
        });
    }

    unregisterKeybindings() {
        let domain = "line-" + this.props.lineid;
        GlobalModel.keybindManager.unregisterDomain(domain);
    }

    componentWillUnmount(): void {
        this.unregisterKeybindings();
    }

    render(): React.ReactNode {
        return null;
    }
}

@mobxReact.observer
class TerminalRenderer extends React.PureComponent<
    {
        screen: LineContainerType;
        line: LineType;
        width: number;
        staticRender: boolean;
        visible: OV<boolean>;
        onHeightChange: () => void;
        collapsed: boolean;
    },
    {}
> {
    termLoaded: mobx.IObservableValue<boolean> = mobx.observable.box(false, {
        name: "linecmd-term-loaded",
    });
    elemRef: React.RefObject<any> = React.createRef();
    termRef: React.RefObject<any> = React.createRef();

    constructor(props) {
        super(props);
    }

    componentDidMount() {
        this.componentDidUpdate(null, null, null);
    }

    componentWillUnmount() {
        if (this.termLoaded.get()) {
            this.unloadTerminal(true);
        }
    }

    getSnapshotBeforeUpdate(prevProps, prevState): { height: number } {
        const elem = this.elemRef.current;
        if (elem == null) {
            return { height: 0 };
        }
        return { height: elem.offsetHeight };
    }

    componentDidUpdate(prevProps, prevState, snapshot: { height: number }): void {
        if (this.props.onHeightChange == null) {
            return;
        }
        let curHeight = 0;
        const elem = this.elemRef.current;
        if (elem != null) {
            curHeight = elem.offsetHeight;
        }
        if (snapshot == null) {
            snapshot = { height: 0 };
        }
        if (snapshot.height != curHeight) {
            this.props.onHeightChange();
            // console.log("term-render height change: ", line.linenum, snapshot.height, "=>", curHeight);
        }
        this.checkLoad();
    }

    checkLoad(): void {
        let { staticRender, visible, collapsed } = this.props;
        if (staticRender) {
            return;
        }
        const vis = visible?.get() && !collapsed;
        const curVis = this.termLoaded.get();
        if (vis && !curVis) {
            this.loadTerminal();
        } else if (!vis && curVis) {
            this.unloadTerminal(false);
        }
    }

    loadTerminal(): void {
        const { screen, line } = this.props;
        const cmd = screen.getCmd(line);
        if (cmd == null) {
            return;
        }
        const termElem = this.termRef.current;
        if (termElem == null) {
            console.log("cannot load terminal, no term elem found", line);
            return;
        }
        screen.loadTerminalRenderer(termElem, line, cmd, this.props.width);
        mobx.action(() => this.termLoaded.set(true))();
    }

    unloadTerminal(unmount: boolean): void {
        const { screen, line } = this.props;
        screen.unloadRenderer(line.lineid);
        if (!unmount) {
            mobx.action(() => this.termLoaded.set(false))();
            const termElem = this.termRef.current;
            if (termElem != null) {
                termElem.replaceChildren();
            }
        }
    }

    @boundMethod
    clickTermBlock(e: any) {
        const { screen, line } = this.props;
        const termWrap = screen.getTermWrap(line.lineid);
        if (termWrap != null) {
            termWrap.giveFocus();
        }
    }

    render() {
        const { screen, line, width, collapsed } = this.props;
        const isPhysicalFocused = mobx
            .computed(() => screen.getIsFocused(line.linenum), {
                name: "computed-getIsFocused",
            })
            .get();
        const isFocused = mobx
            .computed(
                () => {
                    let screenFocusType = screen.getFocusType();
                    return isPhysicalFocused && screenFocusType == "cmd";
                },
                { name: "computed-isFocused" }
            )
            .get();
        const cmd = screen.getCmd(line); // will not be null
        const usedRows = screen.getUsedRows(lineutil.getRendererContext(line), line, cmd, width);
        let termHeight = termHeightFromRows(usedRows, GlobalModel.getTermFontSize(), cmd.getTermMaxRows());
        if (usedRows === 0) {
            termHeight = 0;
        }
        const termLoaded = this.termLoaded.get();
        const lineid = line.lineid;
        const termWrap = screen.getTermWrap(lineid);
        return (
            <div
                ref={this.elemRef}
                key="term-wrap"
                className={cn(
                    "terminal-wrapper",
                    { focus: isFocused },
                    { "cmd-done": !cmd.isRunning() },
                    { "zero-height": termHeight == 0 },
                    { collapsed: collapsed }
                )}
                data-usedrows={usedRows}
            >
                <If condition={!isFocused}>
                    <div key="term-block" className="term-block" onClick={this.clickTermBlock}></div>
                </If>
                <If condition={isFocused}>
                    <TerminalKeybindings termWrap={termWrap} lineid={lineid}></TerminalKeybindings>
                </If>
                <div
                    key="term-connectelem"
                    className="terminal-connectelem"
                    ref={this.termRef}
                    data-lineid={line.lineid}
                    style={{ height: termHeight }}
                ></div>
                <If condition={!termLoaded}>
                    <div key="term-loading" className="terminal-loading-message">
                        ...
                    </div>
                </If>
            </div>
        );
    }
}

export { TerminalRenderer };
