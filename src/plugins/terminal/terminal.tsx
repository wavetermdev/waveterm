import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { If } from "tsx-control-statements/components";
import { GlobalModel, LineContainerModel } from "../../model/model";
import { termHeightFromRows } from "../../util/textmeasure";
import type { LineType } from "../../types/types";
import cn from "classnames";
import * as lineutil from "../../app/line/lineutil";

import "./terminal.less";

dayjs.extend(localizedFormat);

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K, V> = mobx.ObservableMap<K, V>;

@mobxReact.observer
class TerminalRenderer extends React.Component<
    {
        screen: LineContainerModel;
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
        let elem = this.elemRef.current;
        if (elem == null) {
            return { height: 0 };
        }
        return { height: elem.offsetHeight };
    }

    componentDidUpdate(prevProps, prevState, snapshot: { height: number }): void {
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
        // TODO: replace the +2 with some calculation based on termFontSize.  the +2 is for descenders, which get cut off without this.
        let termHeight = termHeightFromRows(usedRows, GlobalModel.termFontSize.get()) + 2;
        if (usedRows === 0) {
            termHeight = 0;
        }
        let termLoaded = this.termLoaded.get();
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
            >
                <If condition={!isFocused}>
                    <div key="term-block" className="term-block" onClick={this.clickTermBlock}></div>
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
