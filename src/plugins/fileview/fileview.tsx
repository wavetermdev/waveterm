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

import "./fileview.less";

type OV<V> = mobx.IObservableValue<V>;

type CopyFileState = {
    file: string;
    progress: number;
    operation: string;
};

const OperationDownload = "download";
const OperationUpload = "upload";

const DirListMaxFiles = 5000;
const ColumnMinSize = 8;

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
    needsReloadDir: OV<boolean>;
    dirList: mobx.IObservableArray<any>;
    dirListCache: Array<any>;
    version: OV<number>;
    packetData: PacketDataBuffer;
    curDirectory: string;
    outputPos: number;
    search: OV<boolean>;
    searchText: OV<string>;
    curCopyFileState: CopyFileState;
    error: string;
    fileViewStateVersion: OV<number>;

    constructor() {
        this.updateHeight_debounced = debounce(1000, this.updateHeight.bind(this));
    }

    initialize(params: T.RendererModelInitializeParams): void {
        this.loading = mobx.observable.box(true, { name: "renderer-loading" });
        this.isDone = mobx.observable.box(params.isDone, { name: "renderer-isDone" });
        this.search = mobx.observable.box(false, { name: "renderer-search" });
        this.needsReloadDir = mobx.observable.box(false, { name: "renderer-needs-reload-dir" });
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
        this.dirListCache = [];
        this.packetData = new PacketDataBuffer(this.packetCallback);
        this.lineState = params.lineState;
        this.curDirectory = this.lineState["prompt:file"];
        console.log("curDirectory: ", this.curDirectory);
        setTimeout(() => this.reload(0), 10);
        this.curCopyFileState = null;
        this.error = "";
        this.fileViewStateVersion = mobx.observable.box(0, { name: "renderer-copyfilestate-version" });
    }

    @boundMethod
    packetCallback(packetAny: any) {
        let fileInfoPacket: T.FileInfoType = packetAny;
        if (fileInfoPacket != null && fileInfoPacket.type == "filestat") {
            console.log(fileInfoPacket);
            this.curDirectory = fileInfoPacket.path;
            this.dirListCache = [];
            mobx.action(() => {
                if (this.dirList.length < DirListMaxFiles) {
                    this.dirList.push(fileInfoPacket);
                } else {
                    this.error = "Error: The maximum amount of files has been reached. file output has been truncated.";
                    this.fileViewStateVersion.set(this.fileViewStateVersion.get() + 1);
                }
                this.needsReloadDir.set(false);
            })();
            return;
        }
        let fileViewStatePacket: T.FileViewStateType = packetAny;
        if (fileViewStatePacket != null && fileViewStatePacket.type == "fileviewstate") {
            console.log("File view state packet: ", fileViewStatePacket, this.curCopyFileState);
            if (fileViewStatePacket.file && fileViewStatePacket.file != "" && fileViewStatePacket.progress) {
                if (this.curCopyFileState != null && this.curCopyFileState.file == fileViewStatePacket.file) {
                    this.curCopyFileState.progress = fileViewStatePacket.progress;
                    mobx.action(() => {
                        this.fileViewStateVersion.set(this.fileViewStateVersion.get() + 1);
                    })();
                    if (fileViewStatePacket.progress == 100) {
                        mobx.action(() => {
                            this.needsReloadDir.set(true);
                        })();
                        setTimeout(() => this.reload(0), 10);
                    }
                }
            }
            return;
        }
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
        console.log("reloading");
        mobx.action(() => {
            this.dirList.clear();
        })();
        if (this.needsReloadDir.get()) {
            console.log("needs reload dir");
            mobx.action(() => {
                this.needsReloadDir.set(false);
            })();
            this.changeDirectory(".");
            return;
        } else if (this.dirListCache.length != 0) {
            mobx.action(() => {
                this.dirList.replace(this.dirListCache);
            })();
        } else {
            console.log("resetting packet data");
            this.getPtyData(delayMs, (ptydata) => {
                mobx.action(() => {
                    this.loading.set(false);
                    this.dirList.clear();
                })();
                this.packetData.reset();
                this.receiveData(ptydata.pos, ptydata.data, "reload");
            });
        }
    }

    updateHeight(newHeight: number): void {
        if (this.savedHeight != newHeight) {
            this.savedHeight = newHeight;
            this.api.saveHeight(newHeight);
        }
    }

    changeDirectory(fileName: string) {
        let newDir = GlobalModel.getApi().pathJoin(this.curDirectory, fileName);
        this.setDirectory(newDir);
    }

    setDirectory(newDir: string) {
        if (this.curCopyFileState != null && this.curCopyFileState.progress != 100) {
            return;
        }
        this.packetData.reset();
        mobx.action(() => {
            this.dirList.clear();
        })();
        let prtn = GlobalModel.submitViewDirCommand(newDir, this.rawCmd.lineid, this.rawCmd.screenid);
        prtn.then((rtn) => {
            if (!rtn.success) {
                console.log("submit view dir command error:", rtn.error);
                // to do: display this as an error
                setTimeout(() => this.reload(0), 10);
            }
        });
    }

    fileWasClicked(event: any, file: any) {
        let fileName = file.name;
        let cwd = GlobalModel.getCmdByScreenLine(this.rawCmd.screenid, this.rawCmd.lineid).getAsWebCmd().festate["cwd"];
        let fileFullPath = GlobalModel.getApi().pathJoin(file.path, fileName);
        console.log("fileFullPath", fileFullPath);
        if (fileName == ".." || file.isdir) {
            this.setDirectory(fileFullPath);
            // change directories
        }
    }

    downloadWasClicked(event: any, sourceFile: any, destPath: string) {
        event.stopPropagation();
        if (this.curCopyFileState != null && this.curCopyFileState.progress != 100) {
            return;
        }
        this.packetData.reset();
        if (destPath == "") {
            destPath = "~/";
        }
        let fileName = sourceFile.name;
        let cwd = this.rawCmd.festate["cwd"];
        let curRemoteName = this.rawCmd.remote.alias;
        let fileFullPath = GlobalModel.getApi().pathJoin(cwd, fileName);
        this.curCopyFileState = { file: fileFullPath, progress: 0, operation: OperationDownload };
        mobx.action(() => {
            this.fileViewStateVersion.set(this.fileViewStateVersion.get() + 1);
            this.dirListCache = Object.assign([], this.dirList.slice());
        })();
        let commandStr = "/copyfile [" + curRemoteName + "]:" + fileFullPath + " [local]:" + destPath;
        let prtn = GlobalModel.submitPtyOutCommand(commandStr, this.rawCmd.lineid, this.rawCmd.screenid);
        prtn.then((rtn) => {
            if (!rtn.success) {
                console.log("submit view dir command error:", rtn.error);
                // to do: display this as an error
            }
            // download was successful
        });
    }

    uploadWasClicked(event: any, filePath: string) {
        event.stopPropagation();
        if (this.curCopyFileState != null && this.curCopyFileState.progress != 100) {
            return;
        }
        this.packetData.reset();
        let destFileFullPath = this.curDirectory;
        let curRemoteName = this.rawCmd.remote.alias;
        this.curCopyFileState = { file: filePath, progress: 0, operation: OperationUpload };
        mobx.action(() => {
            this.fileViewStateVersion.set(this.fileViewStateVersion.get() + 1);
            this.dirListCache = Object.assign([], this.dirList.slice());
        })();
        let commandStr = "/copyfile [local]:" + filePath + " [" + curRemoteName + "]:" + destFileFullPath;
        let prtn = GlobalModel.submitPtyOutCommand(commandStr, this.rawCmd.lineid, this.rawCmd.screenid);
        prtn.then((rtn) => {
            if (!rtn.success) {
                console.log("submit view dir command error:", rtn.error);
                // to do: display this as an error
            }
            this.reload(0);
        });
    }

    searchButtonClicked(event: any) {
        mobx.action(() => {
            this.search.set(true);
        })();
    }

    homeButtonClicked(event: any) {
        let cwd = this.rawCmd.festate["cwd"];
        this.setDirectory(cwd);
    }

    @boundMethod
    closeSearchModal(): void {
        mobx.action(() => {
            this.search.set(false);
            GlobalModel.modalsModel.popModal();
        })();
    }

    handleSearch(searchText: string) {
        this.closeSearchModal();
        if (searchText == "") {
            return;
        }
        this.packetData.reset();
        this.dirList.clear();
        let searchPath = this.curDirectory;
        let commandStr = "/searchdir " + searchPath + " " + searchText;
        let prtn = GlobalModel.submitPtyOutCommand(commandStr, this.rawCmd.lineid, this.rawCmd.screenid);
        prtn.then((rtn) => {
            if (!rtn.success) {
                console.log("submit view dir command error:", rtn.error);
                // to do: display this as an error
            }
        });
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
            this.tempSearchField.set("");
        })();
    }

    renderSearchModal() {
        let rendererModel = this.props.model;
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
        let downloadFileInputRef: React.RefObject<HTMLInputElement> = React.createRef();
        const downloadButtonClicked = (event) => {
            event.stopPropagation();
            downloadFileInputRef.current.setAttribute("directory", "");
            downloadFileInputRef.current.setAttribute("webkitdirectory", "");
            downloadFileInputRef.current.click();
        };
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
                    <div className="download-button" onClick={(event) => downloadButtonClicked(event)}>
                        <i className="fa-sharp fa-solid fa-download"></i>
                        <input
                            type="file"
                            className="fileInput"
                            ref={downloadFileInputRef}
                            onChange={(event) => this.onDownloadFileInputChange(event, file)}
                        ></input>
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

    renderBottomPanel() {
        let model: FileViewRendererModel = this.props.model;
        let copyFileStateVersion = model.fileViewStateVersion.get();
        let spanId = "span-" + copyFileStateVersion;
        let copyFileState = model.curCopyFileState;
        let infoText = "";
        if (model.error != "") {
            infoText = "error: " + model.error;
        } else if (copyFileState == null) {
            return;
        } else if (copyFileState.progress == 100) {
            infoText += copyFileState.file + " ";
            if (copyFileState.operation == OperationDownload) {
                infoText += "Finished Downloading";
            } else if (copyFileState.operation == OperationUpload) {
                infoText += "Finished Uploading";
            }
        } else {
            if (copyFileState.operation == OperationDownload) {
                infoText += "Downloading";
            } else if (copyFileState.operation == OperationUpload) {
                infoText += "Uploading";
            }
            infoText += " " + copyFileState.file;
            infoText += " Progress: " + copyFileState.progress + "%";
        }
        return <span id={spanId}>{infoText}</span>;
    }

    renderInactive() {
        return (
            <div className="fileview-toplevel">
                <div className="status-bar">Inactive: run fileview again to view files</div>
            </div>
        );
    }

    onUploadFileInputChange(event) {
        let uploadedFiles = event.target.files;
        for (let file of uploadedFiles) {
            this.props.model.uploadWasClicked(event, file.path);
        }
    }

    onDownloadFileInputChange(event, sourceFile) {
        let uploadedFile: string = event.target.files[0].path;
        let dirName = GlobalModel.getApi().pathDirName(uploadedFile);
        this.props.model.downloadWasClicked(event, sourceFile, dirName);
    }

    render() {
        let model: FileViewRendererModel = this.props.model;
        let dirList = model.dirList;
        let file: any;
        let index: number;
        let columnMinSize = ColumnMinSize;
        let numColumnsUncapped = dirList.length > columnMinSize ? Math.floor(dirList.length / columnMinSize) : 1;
        console.log("numColumnsUncapped", numColumnsUncapped);
        let columnWidth = Math.min(numColumnsUncapped, 4);
        let shouldRenderBottomPanel = model.curCopyFileState != null;
        let copyFileStateVersion = model.fileViewStateVersion.get();
        let bottomPanelId = "bottom-panel-" + copyFileStateVersion;
        let curDirectory = this.props.model.curDirectory;
        let uploadFileInputRef: React.RefObject<HTMLInputElement> = React.createRef();
        const uploadButtonClicked = () => {
            if (uploadFileInputRef.current != null) {
                uploadFileInputRef.current.click();
            }
        };
        return (
            <div className="fileview-toplevel">
                <div className="status-bar">
                    {curDirectory}
                    {this.renderSearchModal()}
                    <div className="status-bar-icon" onClick={(event) => this.props.model.searchButtonClicked(event)}>
                        <i className="fa-sharp fa-solid fa-magnifying-glass"></i>
                    </div>
                    <div className="status-bar-icon" onClick={uploadButtonClicked}>
                        <i className="fa-sharp fa-solid fa-upload"></i>
                        <input
                            type="file"
                            className="fileInput"
                            ref={uploadFileInputRef}
                            onChange={(event) => this.onUploadFileInputChange(event)}
                        ></input>
                    </div>
                    <div className="status-bar-icon" onClick={(event) => this.props.model.homeButtonClicked(event)}>
                        <i className="fa-sharp fa-solid fa-house"></i>
                    </div>
                </div>
                <div className="fileview-container" style={{ columnCount: columnWidth, columnWidth: "auto" }}>
                    <For each="file" index="index" of={dirList}>
                        {this.renderFile(file, index)}
                    </For>
                </div>
                <If condition={shouldRenderBottomPanel}>
                    <div className="bottom-info-panel" id={bottomPanelId}>
                        {this.renderBottomPanel()};
                    </div>
                </If>
            </div>
        );
    }
}

export { FileViewRendererModel, FileViewRenderer };
