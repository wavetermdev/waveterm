// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import Editor, { Monaco } from "@monaco-editor/react";
import type * as MonacoTypes from "monaco-editor/esm/vs/editor/editor.api";
import cn from "classnames";
import { If } from "tsx-control-statements/components";
import { Markdown, Button } from "@/elements";
import { GlobalModel, GlobalCommandRunner } from "@/models";
import Split from "react-split-it";
import loader from "@monaco-editor/loader";
import { checkKeyPressed, adaptFromReactOrNativeKeyEvent } from "@/util/keyutil";

import "./code.less";

// TODO: need to update these on theme change (pull from CSS vars)
document.addEventListener("DOMContentLoaded", () => {
    loader.config({ paths: { vs: "./node_modules/monaco-editor/min/vs" } });
    loader.init().then(() => {
        monaco.editor.defineTheme("wave-theme-dark", {
            base: "hc-black",
            inherit: true,
            rules: [],
            colors: {
                "editor.background": "#000000",
            },
        });

        monaco.editor.defineTheme("wave-theme-light", {
            base: "hc-light",
            inherit: true,
            rules: [],
            colors: {
                "editor.background": "#fefefe",
            },
        });
    });
});

function renderCmdText(text: string): any {
    return <span>&#x2318;{text}</span>;
}

// there is a global monaco variable (TODO get the correct TS type)
declare var monaco: any;

class SourceCodeRenderer extends React.Component<
    {
        data: ExtBlob;
        cmdstr: string;
        cwd: string;
        readOnly: boolean;
        notFound: boolean;
        exitcode: number;
        context: RendererContext;
        opts: RendererOpts;
        savedHeight: number;
        scrollToBringIntoViewport: () => void;
        lineState: LineStateType;
        isSelected: boolean;
        shouldFocus: boolean;
        rendererApi: RendererModelContainerApi;
    },
    {
        code: string;
        languages: string[];
        selectedLanguage: string;
        isSave: boolean;
        isClosed: boolean;
        editorHeight: number;
        message: { status: "success" | "error"; text: string };
        isPreviewerAvailable: boolean;
        showPreview: boolean;
        editorFraction: number;
        showReadonly: boolean;
    }
> {
    /**
     * codeCache is a Hashmap with key=screenId:lineId:filepath and value=code
     * Editor should never read the code directly from the filesystem. it should read from the cache.
     */
    static readonly codeCache = new Map();

    // which languages have preview options
    languagesWithPreviewer: string[] = ["markdown", "mdx"];
    filePath: string;
    cacheKey: string;
    originalCode: string;
    monacoEditor: MonacoTypes.editor.IStandaloneCodeEditor; // reference to mounted monaco editor.  TODO need the correct type
    markdownRef: React.RefObject<HTMLDivElement>;
    syncing: boolean;

    constructor(props) {
        super(props);
        this.monacoEditor = null;
        const editorHeight = Math.max(props.savedHeight - this.getEditorHeightBuffer(), 0); // must subtract the padding/margin to get the real editorHeight
        this.markdownRef = React.createRef();
        this.syncing = false;
        let isClosed = props.lineState["prompt:closed"];
        this.state = {
            code: null,
            languages: [],
            selectedLanguage: "",
            isSave: false,
            isClosed: isClosed,
            editorHeight,
            message: null,
            isPreviewerAvailable: false,
            showPreview: this.props.lineState["showPreview"],
            editorFraction: this.props.lineState["editorFraction"] || 0.5,
            showReadonly: false,
        };
    }

    componentDidMount(): void {
        this.filePath = this.props.lineState["prompt:file"];
        const { screenId, lineId } = this.props.context;
        this.cacheKey = `${screenId}-${lineId}-${this.filePath}`;
        const code = SourceCodeRenderer.codeCache.get(this.cacheKey);
        if (code) {
            this.setState({ code });
        } else {
            this.props.data.text().then((code) => {
                this.originalCode = code;
                this.setState({ code });
                SourceCodeRenderer.codeCache.set(this.cacheKey, code);
            });
        }
    }

    componentDidUpdate(prevProps: any): void {
        if (!prevProps.shouldFocus && this.props.shouldFocus) {
            if (this.monacoEditor) {
                this.monacoEditor.focus();
            }
        }
    }

    saveLineState = (kvp) => {
        const { screenId, lineId } = this.props.context;
        GlobalCommandRunner.setLineState(screenId, lineId, { ...this.props.lineState, ...kvp }, false);
    };

    setInitialLanguage = (editor) => {
        // set all languages
        const languages = monaco.languages.getLanguages().map((lang) => lang.id);
        this.setState({ languages });
        // detect the current language from previous settings
        let detectedLanguage = this.props.lineState["lang"];
        // if not found, we try to grab the filename from with filePath (coming from lineState["prompt:file"]) or cmdstr
        if (!detectedLanguage) {
            const strForFilePath = this.filePath || this.props.cmdstr;
            const extension = RegExp(/(?:[^\\/:*?"<>|\r\n]+\.)([a-zA-Z0-9]+)\b/).exec(strForFilePath)?.[1] || "";
            const detectedLanguageObj = monaco.languages
                .getLanguages()
                .find((lang) => lang.extensions?.includes("." + extension));
            if (detectedLanguageObj) {
                detectedLanguage = detectedLanguageObj.id;
                this.saveLineState({ lang: detectedLanguage });
            }
        }
        if (detectedLanguage) {
            const model = editor.getModel();
            if (model) {
                monaco.editor.setModelLanguage(model, detectedLanguage);
                this.setState({
                    selectedLanguage: detectedLanguage,
                    isPreviewerAvailable: this.languagesWithPreviewer.includes(detectedLanguage),
                });
            }
        }
    };

    handleEditorDidMount = (editor: MonacoTypes.editor.IStandaloneCodeEditor, monaco: Monaco) => {
        this.monacoEditor = editor;
        this.setInitialLanguage(editor);
        this.setEditorHeight();
        setTimeout(() => {
            const opts = this.getEditorOptions();
            editor.updateOptions(opts);
        }, 2000);
        editor.onKeyDown((e: MonacoTypes.IKeyboardEvent) => {
            const waveEvent = adaptFromReactOrNativeKeyEvent(e.browserEvent);
            if (checkKeyPressed(waveEvent, "Cmd:s") && this.state.isSave) {
                e.preventDefault();
                e.stopPropagation();
                this.doSave();
            }
            if (checkKeyPressed(waveEvent, "Cmd:d")) {
                e.preventDefault();
                e.stopPropagation();
                this.doClose();
            }
            if (checkKeyPressed(waveEvent, "Cmd:p")) {
                e.preventDefault();
                e.stopPropagation();
                this.togglePreview();
            }
        });
        editor.onDidScrollChange((e) => {
            if (!this.syncing && e.scrollTopChanged) {
                this.syncing = true;
                this.handleEditorScrollChange(e);
                this.syncing = false;
            }
        });
        if (this.props.shouldFocus) {
            this.monacoEditor.focus();
            this.props.rendererApi.onFocusChanged(true);
        }
        if (this.monacoEditor.onDidFocusEditorWidget) {
            this.monacoEditor.onDidFocusEditorWidget(() => {
                this.props.rendererApi.onFocusChanged(true);
            });
            this.monacoEditor.onDidBlurEditorWidget(() => {
                this.props.rendererApi.onFocusChanged(false);
            });
        }
        if (!this.getAllowEditing()) this.setState({ showReadonly: true });
    };

    handleEditorScrollChange(e) {
        if (!this.state.showPreview) return;
        const scrollableHeightEditor = this.monacoEditor.getScrollHeight() - this.monacoEditor.getLayoutInfo().height;
        const verticalScrollPercentage = e.scrollTop / scrollableHeightEditor;
        const markdownDiv = this.markdownRef.current;
        if (markdownDiv) {
            const scrollableHeightMarkdown = markdownDiv.scrollHeight - markdownDiv.clientHeight;
            markdownDiv.scrollTop = verticalScrollPercentage * scrollableHeightMarkdown;
        }
    }

    handleDivScroll() {
        if (!this.syncing) {
            this.syncing = true;
            // Calculate the scroll percentage for the markdown div
            const markdownDiv = this.markdownRef.current;
            const scrollableHeightMarkdown = markdownDiv.scrollHeight - markdownDiv.clientHeight;
            const verticalScrollPercentage = markdownDiv.scrollTop / scrollableHeightMarkdown;

            // Apply the same percentage to the editor
            const scrollableHeightEditor =
                this.monacoEditor.getScrollHeight() - this.monacoEditor.getLayoutInfo().height;
            this.monacoEditor.setScrollTop(verticalScrollPercentage * scrollableHeightEditor);

            this.syncing = false;
        }
    }

    handleLanguageChange = (e: any) => {
        const selectedLanguage = e.target.value;
        this.setState({
            selectedLanguage,
            isPreviewerAvailable: this.languagesWithPreviewer.includes(selectedLanguage),
        });
        if (this.monacoEditor) {
            const model = this.monacoEditor.getModel();
            if (model) {
                monaco.editor.setModelLanguage(model, selectedLanguage);
                this.saveLineState({ lang: selectedLanguage });
            }
        }
    };

    doSave = (onSave = () => {}) => {
        if (!this.state.isSave) return;
        const { screenId, lineId } = this.props.context;
        const encodedCode = new TextEncoder().encode(this.state.code);
        GlobalModel.writeRemoteFile(screenId, lineId, this.filePath, encodedCode, { useTemp: true })
            .then(() => {
                this.originalCode = this.state.code;
                this.setState(
                    {
                        isSave: false,
                        message: { status: "success", text: `Saved to ${this.props.cwd}/${this.filePath}` },
                    },
                    onSave
                );
                setTimeout(() => this.setState({ message: null }), 3000);
            })
            .catch((e) => {
                this.setState({ message: { status: "error", text: e.message } });
                setTimeout(() => this.setState({ message: null }), 3000);
            });
    };

    doClose = () => {
        // if there is unsaved data
        if (this.state.isSave)
            return GlobalModel.showAlert({
                message: "Do you want to Save your changes before closing?",
                confirm: true,
            }).then((result) => {
                if (result) return this.doSave(this.doClose);
                this.setState({ code: this.originalCode, isSave: false }, this.doClose);
            });
        const { screenId, lineId } = this.props.context;
        GlobalCommandRunner.setLineState(screenId, lineId, { ...this.props.lineState, "prompt:closed": true }, false)
            .then(() => {
                this.setState({
                    isClosed: true,
                    message: { status: "success", text: `Closed. This editor is now read-only` },
                    showReadonly: true,
                });
                setTimeout(() => {
                    this.setEditorHeight();
                }, 100);
                setTimeout(() => {
                    this.setState({ message: null });
                }, 3000);
            })
            .catch((e) => {
                this.setState({ message: { status: "error", text: e.message } });

                setTimeout(() => {
                    this.setState({ message: null });
                }, 3000);
            });
        if (this.props.shouldFocus) {
            GlobalCommandRunner.screenSetFocus("input");
        }
    };

    handleEditorChange = (code) => {
        SourceCodeRenderer.codeCache.set(this.cacheKey, code);
        this.setState({ code }, () => {
            this.setEditorHeight();
            this.setState({ isSave: code !== this.originalCode });
        });
    };

    getEditorHeightBuffer(): number {
        const heightBuffer = GlobalModel.lineHeightEnv.lineHeight + 11;
        return heightBuffer;
    }

    setEditorHeight = () => {
        const maxEditorHeight = this.props.opts.maxSize.height - this.getEditorHeightBuffer();
        let _editorHeight = maxEditorHeight;
        const allowEditing = this.getAllowEditing();
        if (!allowEditing) {
            const noOfLines = Math.max(this.state.code.split("\n").length, 5);
            const lineHeight = Math.ceil(GlobalModel.lineHeightEnv.lineHeight);
            _editorHeight = Math.min(noOfLines * lineHeight + 10, maxEditorHeight);
        }
        this.setState({ editorHeight: _editorHeight }, () => {
            if (this.props.isSelected) {
                this.props.scrollToBringIntoViewport();
            }
        });
    };

    getAllowEditing(): boolean {
        const lineState = this.props.lineState;
        const mode = lineState["mode"] || "view";
        if (mode == "view") {
            return false;
        }
        return !(this.props.readOnly || this.state.isClosed);
    }

    updateEditorOpts(): void {
        if (!this.monacoEditor) {
            return;
        }
        const opts = this.getEditorOptions();
        this.monacoEditor.updateOptions(opts);
    }

    getEditorOptions(): MonacoTypes.editor.IEditorOptions {
        const opts: MonacoTypes.editor.IEditorOptions = {
            scrollBeyondLastLine: false,
            fontSize: GlobalModel.getTermFontSize(),
            fontFamily: GlobalModel.getTermFontFamily(),
            readOnly: !this.getAllowEditing(),
        };
        const lineState = this.props.lineState;
        if (this.state.showPreview || ("minimap" in lineState && !lineState["minimap"])) {
            opts.minimap = { enabled: false };
        }
        return opts;
    }

    getCodeEditor = () => {
        const theme = `wave-theme-${GlobalModel.getTheme()}`;
        return (
            <div className="editor-wrap" style={{ maxHeight: this.state.editorHeight }}>
                {this.state.showReadonly && <div className="readonly">{"read-only"}</div>}
                <Editor
                    theme={theme}
                    height={this.state.editorHeight}
                    defaultLanguage={this.state.selectedLanguage}
                    value={this.state.code}
                    onMount={this.handleEditorDidMount}
                    options={this.getEditorOptions()}
                    onChange={this.handleEditorChange}
                />
            </div>
        );
    };

    getPreviewer = () => {
        return (
            <div
                className="scroller"
                style={{ maxHeight: this.state.editorHeight }}
                ref={this.markdownRef}
                onScroll={() => this.handleDivScroll()}
            >
                <Markdown text={this.state.code} style={{ width: "100%", padding: "1rem" }} />
            </div>
        );
    };

    togglePreview = () => {
        this.setState((prevState) => {
            const newPreviewState = { showPreview: !prevState.showPreview };
            this.saveLineState(newPreviewState);
            return newPreviewState;
        });
        setTimeout(() => this.updateEditorOpts(), 0);
    };

    getEditorControls = () => {
        const { selectedLanguage, languages, isPreviewerAvailable, showPreview } = this.state;
        let allowEditing = this.getAllowEditing();
        return (
            <>
                <If condition={isPreviewerAvailable}>
                    <Button className="primary" termInline={true}>
                        <div onClick={this.togglePreview} className={`preview`}>
                            {`${showPreview ? "hide" : "show"} preview (`}
                            {renderCmdText("P")}
                            {`)`}
                        </div>
                    </Button>
                </If>
                <select className="dropdown" value={selectedLanguage} onChange={this.handleLanguageChange}>
                    {languages.map((lang, index) => (
                        <option key={index} value={lang}>
                            {lang}
                        </option>
                    ))}
                </select>
                <If condition={allowEditing}>
                    <Button className="primary" termInline={true}>
                        <div onClick={() => this.doSave()}>
                            {`save (`}
                            {renderCmdText("S")}
                            {`)`}
                        </div>
                    </Button>
                    <Button className="primary" termInline={true}>
                        <div onClick={this.doClose} className={`close`}>
                            {`close (`}
                            {renderCmdText("D")}
                            {`)`}
                        </div>
                    </Button>
                </If>
            </>
        );
    };

    getMessage = () => (
        <div className="messageContainer">
            <div className={`message ${this.state.message.status === "error" ? "error" : ""}`}>
                {this.state.message.text}
            </div>
        </div>
    );

    setSizes = (sizes: number[]) => {
        this.setState({ editorFraction: sizes[0] });
        this.saveLineState({ editorFraction: sizes[0] });
    };

    render() {
        const { exitcode } = this.props;
        const { code, message, isPreviewerAvailable, showPreview, editorFraction } = this.state;
        if (this.state.isClosed) {
            return <div className="code-renderer"></div>;
        }
        if (code == null) {
            return <div className="code-renderer" style={{ height: this.props.savedHeight }} />;
        }
        if (exitcode === 1) {
            return (
                <div
                    className="code-renderer"
                    style={{
                        fontSize: GlobalModel.getTermFontSize(),
                        color: "white",
                    }}
                >
                    {code}
                </div>
            );
        }
        return (
            <div className="code-renderer">
                <Split sizes={[editorFraction, 1 - editorFraction]} onSetSizes={this.setSizes}>
                    {this.getCodeEditor()}
                    {isPreviewerAvailable && showPreview && this.getPreviewer()}
                </Split>
                <div className="flex-spacer" />
                <div className="code-statusbar">
                    <If condition={message != null}>
                        <div className={cn("code-message", { error: message.status == "error" })}>
                            {this.state.message.text}
                        </div>
                    </If>
                    <div className="flex-spacer" />
                    {this.getEditorControls()}
                </div>
            </div>
        );
    }
}

export { SourceCodeRenderer };
