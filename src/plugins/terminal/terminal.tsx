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

class TerminalKeybindings extends React.Component<{ termWrap: any; lineid: string }, {}> {
    componentDidMount(): void {
        this.registerKeybindings();
    }

    registerKeybindings() {
        let keybindManager = GlobalModel.keybindManager;
        let domain = "line-" + this.props.lineid;
        let termWrap = this.props.termWrap;
        keybindManager.registerKeybinding("plugin", domain, "terminal:copy", (waveEvent) => {
            let termWrap = this.props.termWrap;
            let sel = termWrap.terminal.getSelection();
            navigator.clipboard.writeText(sel);
            return true;
        });
        keybindManager.registerKeybinding("plugin", domain, "terminal:paste", (waveEvent) => {
            let p = navigator.clipboard.readText();
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

        // termWrap.terminal.theme = getThemeFromCSSVars(document.querySelector("window-view"));
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
class TerminalRenderer extends React.Component<{
    screen: LineContainerType;
    line: LineType;
    width: number;
    staticRender: boolean;
    visible: OV<boolean>;
    onHeightChange: () => void;
    collapsed: boolean;
}> {
    termLoaded: mobx.IObservableValue<boolean> = mobx.observable.box(false, {
        name: "linecmd-term-loaded",
    });
    elemRef: React.RefObject<any> = React.createRef();
    termRef: React.RefObject<any> = React.createRef();

    constructor(props) {
        super(props);
    }

    componentDidMount() {
        // console.log("blown away terminal ??????????????????");

        this.componentDidUpdate(null, null, null);
    }

    componentWillUnmount() {
        if (this.termLoaded.get()) {
            this.unloadTerminal(true);
        }
    }

    getSnapshotBeforeUpdate(prevProps, prevState): { height: number } {
        let elem = this.elemRef.current;
        if (elem == null) {
            return { height: 0 };
        }
        return { height: elem.offsetHeight };
    }

    componentDidUpdate(prevProps, prevState, snapshot: { height: number }): void {
        // const themeTargetElem = GlobalModel.termThemeTargetElem.get();
        // const x = getThemeFromCSSVars(GlobalModel.termThemeTargetElem.get());
        // console.log("themeTargetElem++++++++", themeTargetElem, x);
        if (this.props.onHeightChange == null) {
            return;
        }
        let { line } = this.props;
        let curHeight = 0;
        let elem = this.elemRef.current;
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
        // console.log("got here++++++++++++++++++++++");
        this.checkLoad();
    }

    checkLoad(): void {
        let { line, staticRender, visible, collapsed } = this.props;
        if (staticRender) {
            return;
        }
        let vis = visible && visible.get() && !collapsed;
        let curVis = this.termLoaded.get();
        if (vis && !curVis) {
            this.loadTerminal();
        } else if (!vis && curVis) {
            this.unloadTerminal(false);
        }
    }

    loadTerminal(): void {
        let { screen, line } = this.props;
        let model = GlobalModel;
        let cmd = screen.getCmd(line);
        if (cmd == null) {
            return;
        }
        let termElem = this.termRef.current;
        if (termElem == null) {
            console.log("cannot load terminal, no term elem found", line);
            return;
        }
        screen.loadTerminalRenderer(termElem, line, cmd, this.props.width);
        mobx.action(() => this.termLoaded.set(true))();
    }

    unloadTerminal(unmount: boolean): void {
        let { screen, line } = this.props;
        screen.unloadRenderer(line.lineid);
        if (!unmount) {
            mobx.action(() => this.termLoaded.set(false))();
            let termElem = this.termRef.current;
            if (termElem != null) {
                termElem.replaceChildren();
            }
        }
    }

    @boundMethod
    clickTermBlock(e: any) {
        let { screen, line } = this.props;
        let model = GlobalModel;
        let termWrap = screen.getTermWrap(line.lineid);
        if (termWrap != null) {
            termWrap.giveFocus();
        }
    }

    render() {
        let { screen, line, width, staticRender, visible, collapsed } = this.props;
        let isPhysicalFocused = mobx
            .computed(() => screen.getIsFocused(line.linenum), {
                name: "computed-getIsFocused",
            })
            .get();
        let isFocused = mobx
            .computed(
                () => {
                    let screenFocusType = screen.getFocusType();
                    return isPhysicalFocused && screenFocusType == "cmd";
                },
                { name: "computed-isFocused" }
            )
            .get();
        let cmd = screen.getCmd(line); // will not be null
        let usedRows = screen.getUsedRows(lineutil.getRendererContext(line), line, cmd, width);
        let termHeight = termHeightFromRows(usedRows, GlobalModel.getTermFontSize(), cmd.getTermMaxRows());
        if (usedRows === 0) {
            termHeight = 0;
        }
        let termLoaded = this.termLoaded.get();
        let lineid = line.lineid;
        let termWrap = screen.getTermWrap(lineid);
        // console.log("++++++++++++++++++", termWrap);
        // termWrap.terminal.theme = getThemeFromCSSVars(GlobalModel.termThemeTargetElem.get());

        // console.log("terminal+++++++++++", this.props.termThemeSrcEl);

        // console.log("re-rendered terminal renderer>>>>>>>>>>>>>>>>>>>", lineid);

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
