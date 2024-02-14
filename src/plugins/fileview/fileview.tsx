import React from "react";
import * as T from "../../types/types";
import { debounce } from "throttle-debounce";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import { parse } from "path";
import { For } from "tsx-control-statements/components";
import { PacketDataBuffer } from "../core/ptydata";
import { boundMethod } from "autobind-decorator";
import { GlobalModel } from "../../models";
import * as path from "path";

import "./fileview.less";

type OV<V> = mobx.IObservableValue<V>;

class FileViewRendererModel {
    context: T.RendererContext;
    opts: T.RendererOpts;
    api: T.RendererModelContainerApi;
    savedHeight: number;
    lineState: T.LineStateType;
    updateHeight_debounced: (newHeight: number) => void;
    ptyDataSource: (termContext: T.TermContextUnion) => Promise<T.PtyDataType>;
    rawCmd: T.WebCmd;
    loading: OV<boolean>;
    isDone: OV<boolean>;
    dirList: mobx.IObservableArray<any>;
    version: OV<number>;
    packetData: PacketDataBuffer;
    curDirectory: string;
    outputPos: number;

    constructor() {
        this.updateHeight_debounced = debounce(1000, this.updateHeight.bind(this));
    }

    initialize(params: T.RendererModelInitializeParams): void {
        this.loading = mobx.observable.box(true, { name: "renderer-loading" });
        this.isDone = mobx.observable.box(params.isDone, { name: "renderer-isDone" });
        this.context = params.context;
        this.opts = params.opts;
        this.api = params.api;
        this.savedHeight = params.savedHeight;
        this.ptyDataSource = params.ptyDataSource;
        this.rawCmd = params.rawCmd;
        this.dirList = mobx.observable.array(null, {
            name: "FileView-directorylist",
        });
        this.packetData = new PacketDataBuffer(this.packetCallback);
        this.lineState = params.lineState;
        this.curDirectory = this.lineState["prompt:file"];
        this.outputPos = 0;
    }

    @boundMethod
    packetCallback(packetAny: any) {
        let packet: T.FileInfoType = packetAny;
        if (packet == null) {
            return;
        }
        this.curDirectory = packet.path;
        this.outputPos = packet.outputpos;
        mobx.action(() => {
            this.dirList.push(packet);
        })();
    }

    dispose(): void {
        return;
    }

    giveFocus(): void {
        return;
    }

    updateOpts(update: T.RendererOptsUpdate): void {
        Object.assign(this.opts, update);
    }

    setIsDone(): void {
        if (this.isDone.get()) {
            return;
        }
        mobx.action(() => {
            this.isDone.set(true);
        })();
    }

    reload(delayMs: number): void {
        return;
    }

    updateHeight(newHeight: number): void {
        if (this.savedHeight != newHeight) {
            this.savedHeight = newHeight;
            this.api.saveHeight(newHeight);
        }
    }

    changeDirectory(fileName: string) {
        let newDir = this.curDirectory + "/" + fileName;
        let prtn = GlobalModel.submitViewDirCommand(newDir, this.rawCmd.lineid, this.rawCmd.screenid, this.outputPos);
        prtn.then((rtn) => {
            if (!rtn.success) {
                console.log("submit view dir command error:", rtn.error);
                // to do: display this as an error
            }
            mobx.action(() => {
                this.dirList.clear();
            })();
        });
    }

    fileWasClicked(event: any, file: any) {
        let fileName = file.name;
        let cwd = GlobalModel.getCmdByScreenLine(this.rawCmd.screenid, this.rawCmd.lineid).getAsWebCmd().festate["cwd"];
        console.log("cwd: ", cwd);
        let fileFullPath = path.join(cwd, fileName);
        console.log("filefull path: ", fileFullPath);
        let fileExtSplit = fileName.split(".");
        let fileExt = "";
        if (fileExtSplit.length > 0) {
            fileExt = fileExtSplit.pop();
        }
        let command = "";
        if (fileName == ".." || file.isdir) {
            this.changeDirectory(fileName);
            // change directories
            return;
        } else if (fileExt == "jpg" || fileExt == "png") {
            command = "/imageview " + fileFullPath;
        } else if (fileExt == "exe" || fileExt == "sh") {
            command = "./" + fileFullPath;
        } else {
            command = "codeedit " + fileFullPath;
        }
        console.log("command: ", command, "fileExt", fileExt);
        let inputModel = GlobalModel.inputModel;
        inputModel.setCurLine(command);
        inputModel.giveFocus();
    }

    downloadWasClicked(event: any, file: any) {
        event.stopPropagation();
        console.log("download was clicked", file);
        let fileName = file.name;
        let cwd = this.rawCmd.festate["cwd"];
        let curRemoteName = this.rawCmd.remote.name;
        console.log("cwd: ", cwd);
        let fileFullPath = path.join(cwd, fileName);
        console.log("filefull path: ", fileFullPath);
        let commandStr = "/copyfile [" + curRemoteName + "]:" + fileFullPath + " ~/";
        let prtn = GlobalModel.submitPtyOutCommand(
            commandStr,
            this.rawCmd.lineid,
            this.rawCmd.screenid,
            this.outputPos
        );
        prtn.then((rtn) => {
            if (!rtn.success) {
                console.log("submit view dir command error:", rtn.error);
                // to do: display this as an error
            }
            // download was successful
        });
    }

    receiveData(pos: number, data: Uint8Array, reason?: string): void {
        this.packetData.receiveData(pos, data, reason);
    }
}

@mobxReact.observer
class FileViewRenderer extends React.Component<{ model: FileViewRendererModel }> {
    constructor(props) {
        super(props);
    }

    renderFile(file: any, index: number) {
        let keyString = "file-" + index;
        return (
            <div
                className="file-container"
                key={keyString}
                onClick={(event) => this.props.model.fileWasClicked(event, file)}
            >
                {file.name}
                <div className="download-button" onClick={(event) => this.props.model.downloadWasClicked(event, file)}>
                    <i className="fa-solid fa-download icon"></i>
                </div>
            </div>
        );
    }

    render() {
        let model: FileViewRendererModel = this.props.model;
        let dirList = model.dirList;
        let file: any;
        let index: number;
        return (
            <div className="fileview-container">
                <For each="file" index="index" of={dirList}>
                    {this.renderFile(file, index)}
                </For>
            </div>
        );
    }
}

export { FileViewRendererModel, FileViewRenderer };
