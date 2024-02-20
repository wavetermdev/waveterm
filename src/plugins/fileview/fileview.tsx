import React from "react";
import * as T from "../../types/types";
import { debounce } from "throttle-debounce";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import { parse } from "path";
import { If, For } from "tsx-control-statements/components";
import { PacketDataBuffer } from "../core/ptydata";
import { boundMethod } from "autobind-decorator";
import { GlobalModel } from "../../models";
import { Modal, TextField, InputDecoration, Tooltip } from "../../app/common/elements";
import cn from "classnames";
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
    search: OV<boolean>;
    searchText: OV<string>;

    constructor() {
        this.updateHeight_debounced = debounce(1000, this.updateHeight.bind(this));
    }

    initialize(params: T.RendererModelInitializeParams): void {
        this.loading = mobx.observable.box(true, { name: "renderer-loading" });
        this.isDone = mobx.observable.box(params.isDone, { name: "renderer-isDone" });
        this.search = mobx.observable.box(false, { name: "renderer-search" });
        this.searchText = mobx.observable.box("", { name: "renderer-searchText" });
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
        setTimeout(() => this.reload(0), 10);
    }

    @boundMethod
    packetCallback(packetAny: any) {
        let packet: T.FileInfoType = packetAny;
        if (packet == null) {
            return;
        }
        console.log("packet: ", packet.name);
        this.curDirectory = packet.path;
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

    getPtyData(delayMs: number, callback: any) {
        let rtnp = this.ptyDataSource(this.context);
        if (rtnp == null) {
            console.log("no promise returned from ptyDataSource (openai renderer)", this.context);
            return;
        }
        rtnp.then((ptydata) => {
            setTimeout(() => {
                callback(ptydata);
            }, delayMs);
        }).catch((e) => {
            console.log("error loading data", e);
        });
    }

    reload(delayMs: number): void {
        mobx.action(() => {
            this.loading.set(true);
            this.dirList.clear();
        })();
        this.getPtyData(delayMs, (ptydata) => {
            this.packetData.reset();
            this.receiveData(ptydata.pos, ptydata.data, "reload");
            mobx.action(() => {
                this.loading.set(false);
            })();
        });
    }

    updateHeight(newHeight: number): void {
        if (this.savedHeight != newHeight) {
            this.savedHeight = newHeight;
            this.api.saveHeight(newHeight);
        }
    }

    changeDirectory(fileName: string) {
        mobx.action(() => {
            this.dirList.clear();
        })();
        let newDir = GlobalModel.getApi().pathJoin(this.curDirectory, fileName);
        let prtn = GlobalModel.submitViewDirCommand(newDir, this.rawCmd.lineid, this.rawCmd.screenid);
        prtn.then((rtn) => {
            if (!rtn.success) {
                console.log("submit view dir command error:", rtn.error);
                // to do: display this as an error
            }
            this.reload(0);
        });
    }

    fileWasClicked(event: any, file: any) {
        let fileName = file.name;
        let cwd = GlobalModel.getCmdByScreenLine(this.rawCmd.screenid, this.rawCmd.lineid).getAsWebCmd().festate["cwd"];
        console.log("cwd: ", cwd);
        let fileFullPath = GlobalModel.getApi().pathJoin(this.curDirectory, fileName);
        let fileRelativePath = GlobalModel.getApi().pathRelative(cwd, fileFullPath);
        console.log("filefull path: ", fileFullPath);
        console.log("file relative path: ", fileRelativePath);
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
            command = "/imageview " + fileRelativePath;
        } else if (fileExt == "exe" || fileExt == "sh") {
            command = "./" + fileRelativePath;
        } else {
            command = "codeedit " + fileRelativePath;
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

    searchButtonClicked(event: any) {
        mobx.action(() => {
            this.search.set(true);
        })();
    }

    @boundMethod
    closeSearchModal(): void {
        console.log("Closing Modal");
        mobx.action(() => {
            this.search.set(false);
            GlobalModel.modalsModel.popModal();
        })();
    }

    handleSearch(searchText: string) {
        console.log("searching: ", searchText);
        this.closeSearchModal();
        if (searchText == "") {
            return;
        }
    }

    receiveData(pos: number, data: Uint8Array, reason?: string): void {
        this.packetData.receiveData(pos, data, reason);
    }
}

@mobxReact.observer
class FileViewRenderer extends React.Component<{ model: FileViewRendererModel }> {
    tempSearchField: OV<string>;

    constructor(props) {
        super(props);
        this.tempSearchField = mobx.observable.box("", { name: "fileview-temp-searchfield" });
    }

    @boundMethod
    handleSearchSubmit() {
        mobx.action(() => {
            let searchText = this.tempSearchField.get();
            this.props.model.handleSearch(searchText);
        })();
    }

    renderSearchModal() {
        let rendererModel = this.props.model;
        let searchText = "";
        return (
            <If condition={rendererModel.search.get()}>
                <Modal>
                    <Modal.Header title="Search Filesystem" onClose={this.props.model.closeSearchModal}></Modal.Header>
                    <TextField
                        label="Search Field"
                        autoFocus={true}
                        value={this.tempSearchField.get()}
                        onChange={(value) => {
                            mobx.action(() => {
                                this.tempSearchField.set(value);
                            })();
                        }}
                        required={true}
                        decoration={{
                            endDecoration: (
                                <InputDecoration>
                                    <Tooltip
                                        message={`The query that you would like to search in the filesystem from this directory`}
                                        icon={<i className="fa-sharp fa-regular fa-circle-question" />}
                                    >
                                        <i className="fa-sharp fa-regular fa-circle-question" />
                                    </Tooltip>
                                </InputDecoration>
                            ),
                        }}
                    />

                    <Modal.Footer
                        onCancel={this.props.model.closeSearchModal}
                        onOk={this.handleSearchSubmit}
                        okLabel="Ok"
                    />
                </Modal>
            </If>
        );
    }

    renderFile(file: any, index: number) {
        let keyString = "file-" + index;
        return (
            <div
                className={cn("file-container", {
                    "dir-container": file.isdir,
                })}
                key={keyString}
                onClick={(event) => this.props.model.fileWasClicked(event, file)}
            >
                {file.name}
                <If condition={!file.isdir}>
                    <div
                        className="download-button"
                        onClick={(event) => this.props.model.downloadWasClicked(event, file)}
                    >
                        <i className="fa-sharp fa-solid fa-download"></i>
                    </div>
                </If>
                <If condition={file.isdir}>
                    <div className="dir-icon">
                        <i className="fa-sharp fa-solid fa-folder"></i>
                    </div>
                </If>
            </div>
        );
    }

    render() {
        let model: FileViewRendererModel = this.props.model;
        let dirList = model.dirList;
        let file: any;
        let index: number;
        let columnMinSize = 6;
        let columnWidth = Math.min(dirList.length / columnMinSize, 4);
        return (
            <div className="fileview-toplevel">
                <div className="status-bar">
                    {this.props.model.curDirectory}
                    {this.renderSearchModal()}
                    <div className="search-icon" onClick={(event) => this.props.model.searchButtonClicked(event)}>
                        <i className="fa-sharp fa-solid fa-magnifying-glass"></i>
                    </div>
                </div>
                <div className="fileview-container" style={{ columnCount: columnWidth, columnWidth: "auto" }}>
                    <For each="file" index="index" of={dirList}>
                        {this.renderFile(file, index)}
                    </For>
                </div>
            </div>
        );
    }
}

export { FileViewRendererModel, FileViewRenderer };
