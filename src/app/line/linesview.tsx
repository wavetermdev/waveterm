// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { If, For, When, Otherwise, Choose } from "tsx-control-statements/components";
import cn from "classnames";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { debounce, throttle } from "throttle-debounce";
import * as util from "@/util/util";
import * as lineutil from "./lineutil";

import "./lines.less";
import { GlobalModel } from "@/models";

dayjs.extend(localizedFormat);

const LinesVisiblePadding = 500;

type ScreenInterface = {
    setAnchorFields(anchorLine: number, anchorOffset: number, reason: string): void;
    getSelectedLine(): number;
    getAnchor(): { anchorLine: number; anchorOffset: number };
    isLineIdInSidebar(lineId: string): boolean;
    getLineByNum(lineNum: number): LineType;
};

// <Line key={line.lineid} line={line} screen={screen} width={width} visible={this.visibleMap.get(lineNumStr)} staticRender={this.staticRender.get()} onHeightChange={this.onHeightChange} overrideCollapsed={this.collapsedMap.get(lineNumStr)} topBorder={topBorder} renderMode={renderMode}/>;

type LineCompFactory = (props: LineFactoryProps) => JSX.Element;

@mobxReact.observer
class LinesView extends React.Component<
    {
        screen: ScreenInterface;
        width: number;
        lines: LineInterface[];
        renderMode: RenderModeType;
        lineFactory: LineCompFactory;
    },
    {}
> {
    rszObs: ResizeObserver;
    linesRef: React.RefObject<any>;
    staticRender: OV<boolean> = mobx.observable.box(true, { name: "static-render" });
    lastOffsetHeight: number = 0;
    lastOffsetWidth: number = 0;
    ignoreNextScroll: boolean = false;
    visibleMap: Map<string, OV<boolean>>; // linenum => OV<vis>
    collapsedMap: Map<string, OV<boolean>>; // linenum => OV<collapsed>
    lastLinesLength: number = 0;
    lastSelectedLine: number = 0;

    computeAnchorLine_throttled: () => void;
    computeVisibleMap_debounced: () => void;

    constructor(props) {
        super(props);
        this.linesRef = React.createRef();
        this.computeAnchorLine_throttled = throttle(100, this.computeAnchorLine.bind(this), {
            noLeading: true,
            noTrailing: false,
        });
        this.visibleMap = new Map();
        this.collapsedMap = new Map();
        this.computeVisibleMap_debounced = debounce(100, this.computeVisibleMap.bind(this));
    }

    @boundMethod
    scrollHandler() {
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            return;
        }
        let heightDiff = linesElem.offsetHeight - this.lastOffsetHeight;
        if (heightDiff > 0) {
            this.ignoreNextScroll = true;
        }
        let fromBottom = linesElem.scrollHeight - linesElem.scrollTop - linesElem.offsetHeight;
        // console.log("scroll", linesElem.scrollTop, (this.ignoreNextScroll ? "ignore" : "------"), "height-diff:" + heightDiff, "scroll-height:" + linesElem.scrollHeight, "from-bottom:" + fromBottom);
        this.computeVisibleMap_debounced(); // always do this
        if (this.ignoreNextScroll) {
            this.ignoreNextScroll = false;
            return;
        }
        this.computeAnchorLine_throttled(); // only do this when we're not ignoring the scroll
    }

    computeAnchorLine(): void {
        let { screen } = this.props;
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            screen.setAnchorFields(null, 0, "no-lines");
            return;
        }
        let lineElemArr = linesElem.querySelectorAll(".line");
        if (lineElemArr == null || lineElemArr.length == 0) {
            screen.setAnchorFields(null, 0, "no-line");
            return;
        }
        let scrollTop = linesElem.scrollTop;
        let height = linesElem.clientHeight;
        let containerBottom = scrollTop + height;
        let anchorElem: HTMLElement = null;
        for (let i = lineElemArr.length - 1; i >= 0; i--) {
            let lineElem = lineElemArr[i];
            let bottomPos = lineElem.offsetTop + lineElem.offsetHeight;
            if (anchorElem == null && (bottomPos <= containerBottom || lineElem.offsetTop <= scrollTop)) {
                anchorElem = lineElem;
            }
        }
        if (anchorElem == null) {
            anchorElem = lineElemArr[0];
        }
        let anchorLineNum = parseInt(anchorElem.dataset.linenum);
        let anchorOffset = containerBottom - (anchorElem.offsetTop + anchorElem.offsetHeight);
        // console.log("compute-anchor-line", anchorLineNum, anchorOffset, "st:" + scrollTop);
        screen.setAnchorFields(anchorLineNum, anchorOffset, "computeAnchorLine");
    }

    computeVisibleMap(): void {
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            return;
        }
        if (linesElem.offsetParent == null) {
            return; // handles when parent is set to display:none (is-hidden)
        }
        let lineElemArr = linesElem.querySelectorAll(".line");
        if (lineElemArr == null) {
            return;
        }
        if (linesElem.clientHeight == 0) {
            return; // when linesElem is collapsed (or display:none)
        }
        let containerTop = linesElem.scrollTop - LinesVisiblePadding;
        let containerBot = linesElem.scrollTop + linesElem.clientHeight + LinesVisiblePadding;
        let newMap = new Map<string, boolean>();
        // console.log("computevismap", linesElem.scrollTop, linesElem.clientHeight, containerTop + "-" + containerBot);
        for (let i = 0; i < lineElemArr.length; i++) {
            let lineElem = lineElemArr[i];
            let lineTop = lineElem.offsetTop;
            let lineBot = lineElem.offsetTop + lineElem.offsetHeight;
            let isVis = false;
            if (lineTop >= containerTop && lineTop <= containerBot) {
                isVis = true;
            }
            if (lineBot >= containerTop && lineBot <= containerBot) {
                isVis = true;
            }
            // console.log("line", lineElem.dataset.linenum, "top=" + lineTop, "bot=" + lineTop, isVis);
            let lineNumInt = parseInt(lineElem.dataset.linenum);
            newMap.set(lineElem.dataset.linenum, isVis);
            // console.log("setvis", sprintf("%4d %4d-%4d (%4d) %s", lineElem.dataset.linenum, lineTop, lineBot, lineElem.offsetHeight, isVis));
        }
        // console.log("compute vismap", "[" + this.firstVisLine + "," + this.lastVisLine + "]");
        mobx.action(() => {
            for (let [k, v] of newMap) {
                let oldVal = this.visibleMap.get(k);
                if (oldVal == null) {
                    oldVal = mobx.observable.box(v, { name: "lines-vis-map" });
                    this.visibleMap.set(k, oldVal);
                }
                if (oldVal.get() != v) {
                    oldVal.set(v);
                }
            }
            for (let [k, v] of this.visibleMap) {
                if (!newMap.has(k)) {
                    this.visibleMap.delete(k);
                }
            }
        })();
    }

    printVisMap(): void {
        let visMap = this.visibleMap;
        let lines = this.props.lines;
        let visLines: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            let linenum = String(lines[i].linenum);
            if (visMap.get(linenum).get()) {
                visLines.push(linenum);
            }
        }
        console.log("vislines", visLines);
    }

    restoreAnchorOffset(reason: string): void {
        let { lines } = this.props;
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            return;
        }
        let anchor = this.getAnchor();
        let anchorElem = linesElem.querySelector(sprintf('.line[data-linenum="%d"]', anchor.anchorLine));
        if (anchorElem == null) {
            return;
        }
        let isLastLine = anchor.anchorIndex == lines.length - 1;
        let scrollTop = linesElem.scrollTop;
        let height = linesElem.clientHeight;
        let containerBottom = scrollTop + height;
        let curAnchorOffset = containerBottom - (anchorElem.offsetTop + anchorElem.offsetHeight);
        let newAnchorOffset = anchor.anchorOffset;
        if (isLastLine && newAnchorOffset == 0) {
            newAnchorOffset = 10;
        }
        if (curAnchorOffset != newAnchorOffset) {
            let offsetDiff = curAnchorOffset - newAnchorOffset;
            let newScrollTop = scrollTop - offsetDiff;
            // console.log("update scrolltop", reason, "line=" + anchor.anchorLine, -offsetDiff, linesElem.scrollTop, "=>", newScrollTop);
            linesElem.scrollTop = newScrollTop;
            this.ignoreNextScroll = true;
        }
    }

    componentDidMount(): void {
        let { screen, lines } = this.props;
        let linesElem = this.linesRef.current;
        let anchor = this.getAnchor();
        if (anchor.anchorIndex == lines.length - 1) {
            if (linesElem != null) {
                linesElem.scrollTop = linesElem.scrollHeight;
            }
            this.computeAnchorLine();
        } else {
            this.restoreAnchorOffset("re-mount");
        }
        this.lastSelectedLine = screen.getSelectedLine();
        this.lastLinesLength = lines.length;
        if (linesElem != null) {
            this.lastOffsetHeight = linesElem.offsetHeight;
            this.lastOffsetWidth = linesElem.offsetWidth;
            this.rszObs = new ResizeObserver(this.handleResize.bind(this));
            this.rszObs.observe(linesElem);
        }
        mobx.action(() => {
            this.staticRender.set(false);
            this.computeVisibleMap();
        })();
    }

    getLineElem(lineNum: number): HTMLElement {
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            return null;
        }
        let elem = linesElem.querySelector(sprintf('.line[data-linenum="%d"]', lineNum));
        return elem;
    }

    getLineViewInfo(lineNum: number): { height: number; topOffset: number; botOffset: number; anchorOffset: number } {
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            return null;
        }
        let lineElem = this.getLineElem(lineNum);
        if (lineElem == null) {
            return null;
        }
        let rtn = {
            height: lineElem.offsetHeight,
            topOffset: 0,
            botOffset: 0,
            anchorOffset: 0,
        };
        let containerTop = linesElem.scrollTop;
        let containerBot = linesElem.scrollTop + linesElem.clientHeight;
        let lineTop = lineElem.offsetTop;
        let lineBot = lineElem.offsetTop + lineElem.offsetHeight;
        if (lineTop < containerTop) {
            rtn.topOffset = lineTop - containerTop;
        } else if (lineTop > containerBot) {
            rtn.topOffset = lineTop - containerBot;
        }
        if (lineBot < containerTop) {
            rtn.botOffset = lineBot - containerTop;
        } else if (lineBot > containerBot) {
            rtn.botOffset = lineBot - containerBot;
        }
        rtn.anchorOffset = containerBot - lineBot;
        return rtn;
    }

    updateSelectedLine(): void {
        let { screen, lines } = this.props;
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            return null;
        }
        let newLine = screen.getSelectedLine();
        if (newLine == 0) {
            return;
        }
        let line = screen.getLineByNum(newLine);
        if (line == null || screen.isLineIdInSidebar(line.lineid)) {
            return;
        }
        let lidx = this.findClosestLineIndex(newLine);
        this.setLineVisible(newLine, true);
        // console.log("update selected line", this.lastSelectedLine, "=>", newLine, sprintf("anchor=%d:%d", screen.anchorLine, screen.anchorOffset));
        let viewInfo = this.getLineViewInfo(newLine);
        let isFirst = lidx.index == 0;
        let isLast = lidx.index == lines.length - 1;
        let offsetDelta = isLast ? 10 : isFirst ? -28 : 0;
        if (viewInfo == null) {
            screen.setAnchorFields(newLine, 0 + offsetDelta, "updateSelectedLine");
        } else if (viewInfo.botOffset > 0) {
            linesElem.scrollTop = linesElem.scrollTop + viewInfo.botOffset + offsetDelta;
            this.ignoreNextScroll = true;
            screen.setAnchorFields(newLine, offsetDelta, "updateSelectedLine");
        } else if (viewInfo.topOffset < 0) {
            linesElem.scrollTop = linesElem.scrollTop + viewInfo.topOffset + offsetDelta;
            this.ignoreNextScroll = true;
            let newOffset = linesElem.clientHeight - viewInfo.height;
            screen.setAnchorFields(newLine, newOffset, "updateSelectedLine");
        } else {
            screen.setAnchorFields(newLine, viewInfo.anchorOffset, "updateSelectedLine");
        }
        // console.log("new anchor", screen.getAnchorStr());
    }

    setLineVisible(lineNum: number, vis: boolean): void {
        mobx.action(() => {
            let key = String(lineNum);
            let visObj = this.visibleMap.get(key);
            if (visObj == null) {
                visObj = mobx.observable.box(true, { name: "lines-vis-map" });
                this.visibleMap.set(key, visObj);
            } else {
                visObj.set(true);
            }
        })();
    }

    componentDidUpdate(prevProps, prevState, snapshot): void {
        let { screen, lines } = this.props;
        if (screen.getSelectedLine() != this.lastSelectedLine) {
            this.updateSelectedLine();
            this.lastSelectedLine = screen.getSelectedLine();
        } else if (lines.length != this.lastLinesLength) {
            this.restoreAnchorOffset("line-length-change");
        }
    }

    componentWillUnmount(): void {
        if (this.rszObs != null) {
            this.rszObs.disconnect();
        }
    }

    handleResize(entries: ResizeObserverEntry[]) {
        let linesElem = this.linesRef.current;
        if (linesElem == null) {
            return;
        }
        let heightDiff = linesElem.offsetHeight - this.lastOffsetHeight;
        if (heightDiff != 0) {
            this.lastOffsetHeight = linesElem.offsetHeight;
            this.restoreAnchorOffset("resize");
        }
        if (this.lastOffsetWidth != linesElem.offsetWidth) {
            this.restoreAnchorOffset("resize-width");
            this.lastOffsetWidth = linesElem.offsetWidth;
        }
        this.computeVisibleMap_debounced();
    }

    @boundMethod
    onHeightChange(lineNum: number, newHeight: number, oldHeight: number): void {
        if (oldHeight == null) {
            return;
        }
        // console.log("height-change", lineNum, oldHeight, "=>", newHeight);
        this.restoreAnchorOffset("height-change");
        this.computeVisibleMap_debounced();
    }

    hasTopBorder(lines: LineInterface[], idx: number): boolean {
        if (idx == 0) {
            return false;
        }
        let curLineNumStr = String(lines[idx].linenum);
        let prevLineNumStr = String(lines[idx - 1].linenum);
        return !this.collapsedMap.get(curLineNumStr).get() || !this.collapsedMap.get(prevLineNumStr).get();
    }

    getDateSepStr(
        lines: LineInterface[],
        idx: number,
        prevStr: string,
        todayStr: string,
        yesterdayStr: string
    ): string {
        let curLineDate = new Date(lines[idx].ts);
        let curLineFormat = dayjs(curLineDate).format("ddd YYYY-MM-DD");
        if (idx == 0) {
            return;
        }
        let prevLineDate = new Date(lines[idx].ts);
        let prevLineFormat = dayjs(prevLineDate).format("YYYY-MM-DD");
        return null;
    }

    findClosestLineIndex(lineNum: number): { line: LineInterface; index: number } {
        let { lines } = this.props;
        if (lines.length == 0) {
            throw new Error("invalid lines, cannot have 0 length in LinesView");
        }
        if (lineNum == null || lineNum == 0) {
            return { line: lines[lines.length - 1], index: lines.length - 1 };
        }
        // todo: bsearch
        // lines is sorted by linenum
        for (let idx = 0; idx < lines.length; idx++) {
            let line = lines[idx];
            if (line.linenum >= lineNum) {
                return { line: line, index: idx };
            }
        }
        return { line: lines[lines.length - 1], index: lines.length - 1 };
    }

    getAnchor(): { anchorLine: number; anchorOffset: number; anchorIndex: number } {
        let { screen, lines } = this.props;
        let anchor = screen.getAnchor();
        if (anchor.anchorLine == null || anchor.anchorLine == 0) {
            return { anchorLine: lines[lines.length - 1].linenum, anchorOffset: 0, anchorIndex: lines.length - 1 };
        }
        let lidx = this.findClosestLineIndex(anchor.anchorLine);
        if (lidx.line.linenum == anchor.anchorLine) {
            return { anchorLine: anchor.anchorLine, anchorOffset: anchor.anchorOffset, anchorIndex: lidx.index };
        }
        return { anchorLine: lidx.line.linenum, anchorOffset: 0, anchorIndex: lidx.index };
    }
    render() {
        let { screen, width, lines, renderMode } = this.props;
        let selectedLine = screen.getSelectedLine(); // for re-rendering
        let line: LineInterface = null;
        for (let i = 0; i < lines.length; i++) {
            let key = String(lines[i].linenum);
            let visObs = this.visibleMap.get(key);
            if (visObs == null) {
                this.visibleMap.set(key, mobx.observable.box(false, { name: "lines-vis-map" }));
            }
            let collObs = this.collapsedMap.get(key);
            if (collObs == null) {
                this.collapsedMap.set(key, mobx.observable.box(false, { name: "lines-collapsed-map" }));
            }
        }
        let lineElements: any = [];
        let todayStr = util.getTodayStr();
        let yesterdayStr = util.getYesterdayStr();
        let prevDateStr: string = null;
        let anchor = this.getAnchor();
        let startIdx = util.boundInt(anchor.anchorIndex - 50, 0, lines.length - 1);
        let endIdx = util.boundInt(anchor.anchorIndex + 50, 0, lines.length - 1);
        // console.log("render", anchor, "[" + startIdx + "," + endIdx + "]");
        for (let idx = startIdx; idx <= endIdx; idx++) {
            let line = lines[idx];
            let lineNumStr = String(line.linenum);
            let dateSepStr = null;
            let curDateStr = lineutil.getLineDateStr(todayStr, yesterdayStr, line.ts);
            if (curDateStr != prevDateStr) {
                dateSepStr = curDateStr;
            }
            prevDateStr = curDateStr;
            if (dateSepStr != null) {
                let sepElem = (
                    <div key={"sep-" + line.lineid} className="line-sep-labeled">
                        {dateSepStr}
                    </div>
                );
                lineElements.push(sepElem);
            } else if (idx > 0) {
                lineElements.push(<div key={"sep-" + line.lineid} className="line-sep"></div>);
            }
            let topBorder = dateSepStr == null && this.hasTopBorder(lines, idx);
            let lineProps = {
                key: line.lineid,
                line: line,
                width: width,
                visible: this.visibleMap.get(lineNumStr),
                staticRender: this.staticRender.get(),
                onHeightChange: this.onHeightChange,
                overrideCollapsed: this.collapsedMap.get(lineNumStr),
                topBorder: topBorder,
                renderMode: renderMode,
            };
            let lineElem = this.props.lineFactory(lineProps, GlobalModel.termThemeSrcEl);
            // let lineElem = <Line key={line.lineid} line={line} screen={screen} width={width} visible={this.visibleMap.get(lineNumStr)} staticRender={this.staticRender.get()} onHeightChange={this.onHeightChange} overrideCollapsed={this.collapsedMap.get(lineNumStr)} topBorder={topBorder} renderMode={renderMode}/>;
            lineElements.push(lineElem);
        }
        let linesClass = cn("lines", renderMode == "normal" ? "lines-expanded" : "lines-collapsed", "wide-scrollbar");
        return (
            <div key="lines" className={linesClass} onScroll={this.scrollHandler} ref={this.linesRef}>
                <div className="lines-spacer"></div>
                {lineElements}
            </div>
        );
    }
}

export { LinesView };
