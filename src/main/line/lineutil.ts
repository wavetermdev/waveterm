import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { isBlank, getDateStr } from "../../util";
import { LineType, WebLine, RendererContext } from "../../types";

dayjs.extend(localizedFormat);

function getRendererType(line: LineType | WebLine): "terminal" | "plugin" {
    if (isBlank(line.renderer) || line.renderer == "terminal") {
        return "terminal";
    }
    return "plugin";
}

function getLineDateStr(todayDate: string, yesterdayDate: string, ts: number): string {
    let lineDate = new Date(ts);
    let dateStr = getDateStr(lineDate);
    if (dateStr == todayDate) {
        return "today";
    }
    if (dateStr == yesterdayDate) {
        return "yesterday";
    }
    return dateStr;
}

function getLineDateTimeStr(ts: number): string {
    let lineDate = new Date(ts);
    let nowDate = new Date();

    if (nowDate.getFullYear() != lineDate.getFullYear()) {
        return dayjs(lineDate).format("ddd L LTS");
    } else if (nowDate.getMonth() != lineDate.getMonth() || nowDate.getDate() != lineDate.getDate()) {
        let yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        if (yesterdayDate.getMonth() == lineDate.getMonth() && yesterdayDate.getDate() == lineDate.getDate()) {
            return "Yesterday " + dayjs(lineDate).format("LTS");
        }
        return dayjs(lineDate).format("ddd L LTS");
    } else {
        return dayjs(lineDate).format("LTS");
    }
}

function isMultiLineCmdText(cmdText: string): boolean {
    if (cmdText == null) {
        return false;
    }
    cmdText = cmdText.trim();
    let nlIdx = cmdText.indexOf("\n");
    return nlIdx != -1;
}

function getFullCmdText(cmdText: string) {
    if (cmdText == null) {
        return "(none)";
    }
    cmdText = cmdText.trim();
    return cmdText;
}

function getSingleLineCmdText(cmdText: string) {
    if (cmdText == null) {
        return "(none)";
    }
    cmdText = cmdText.trim();
    let nlIdx = cmdText.indexOf("\n");
    if (nlIdx != -1) {
        cmdText = cmdText.substr(0, nlIdx);
    }
    return cmdText;
}

function getRendererContext(line: LineType): RendererContext {
    return {
        screenId: line.screenid,
        lineId: line.lineid,
        lineNum: line.linenum,
    };
}

function getWebRendererContext(line: WebLine): RendererContext {
    return {
        screenId: line.screenid,
        lineId: line.lineid,
        lineNum: line.linenum,
    };
}

function cmdStatusIsRunning(status: string): boolean {
    return status == "running" || status == "detached";
}

export {
    getRendererType,
    getLineDateStr,
    getLineDateTimeStr,
    isMultiLineCmdText,
    getFullCmdText,
    getSingleLineCmdText,
    getRendererContext,
    getWebRendererContext,
    cmdStatusIsRunning,
};
