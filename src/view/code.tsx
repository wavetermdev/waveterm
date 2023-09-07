import * as React from "react";
import { RendererContext, RendererOpts, LineStateType } from "../types";
import Editor from "@monaco-editor/react";
import { GlobalModel, GlobalCommandRunner } from "../model";
import loader from "@monaco-editor/loader";
loader.config({ paths: { vs: "./node_modules/monaco-editor/min/vs" } });

function renderCmdText(text: string): any {
    return <span>&#x2318;{text}</span>;
}

class SourceCodeRenderer extends React.Component<
{
    data: Blob;
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
    },
    {}
> {
    /**
     * codeCache is a Hashmap with key=screenId:lineId:filepath and value=code
     * Editor should never read the code directly from the filesystem. it should read from the cache.
     */
    static codeCache = new Map();

    filePath;
    cacheKey;
    originalData;
    constructor(props) {
        super(props);
        this.editorRef = React.createRef();
        this.state = {
            code: null,
            languages: [],
            selectedLanguage: "",
            isSave: false,
            isClosed: false,
            editorHeight: props.savedHeight,
            message: null,
        };
    }

    componentDidMount(): void {
        this.filePath = this.props.lineState["prompt:file"];
        const { screenId, lineId } = this.props.context;
        this.cacheKey = `${screenId}-${lineId}-${this.filePath}`;
        const code = SourceCodeRenderer.codeCache.get(this.cacheKey);
        if (code) {
            this.setState({ code, isClosed: this.props.lineState["prompt:closed"] });
        } else
            this.props.data.text().then((code) => {
                this.originalData = code;
                this.setState({ code, isClosed: this.props.lineState["prompt:closed"] });
                SourceCodeRenderer.codeCache.set(this.cacheKey, code);
            });
    }

    setInitialLanguage = (editor) => {
        const { screenId, lineId } = this.props.context;
        // set all languages
        const languages = monaco.languages.getLanguages().map((lang) => lang.id);
        this.setState({ languages });
        // detect the current language from previous settings
        let detectedLanguage = this.props.lineState["lang"];
        // if not found, we try to grab the filename from with filePath (coming from lineState["prompt:file"]) or cmdstr
        if (!detectedLanguage) {
            const strForFilePath = this.filePath || this.props.cmdstr;
            const extension = strForFilePath.match(/(?:[^\\\/:*?"<>|\r\n]+\.)([a-zA-Z0-9]+)\b/)?.[1] || "";
            const detectedLanguageObj = monaco.languages
                .getLanguages()
                .find((lang) => lang.extensions?.includes("." + extension));
            if (detectedLanguageObj) {
                detectedLanguage = detectedLanguageObj.id;
                GlobalCommandRunner.setLineState(
                    screenId,
                    lineId,
                    { ...this.props.lineState, lang: detectedLanguage },
                    false
                );
            }
        }
        if (detectedLanguage) {
            this.editorRef.current = editor;
            const model = editor.getModel();
            if (model) {
                monaco.editor.setModelLanguage(model, detectedLanguage);
                this.setState({ selectedLanguage: detectedLanguage });
            }
        }
    };

    handleEditorDidMount = (editor, monaco) => {
        this.setInitialLanguage(editor);
        this.setEditorHeight();
        editor.onKeyDown((e) => {
            if (e.code === "KeyS" && (e.ctrlKey || e.metaKey) && this.state.isSave) {
                e.preventDefault();
                this.doSave();
            }
            if (e.code === "KeyD" && (e.ctrlKey || e.metaKey) && !this.state.isSave) {
                e.preventDefault();
                this.doClose();
            }
        });
    };

    handleLanguageChange = (event) => {
        const { screenId, lineId } = this.props.context;
        const selectedLanguage = event.target.value;
        this.setState({ selectedLanguage });
        if (this.editorRef.current) {
            const model = this.editorRef.current.getModel();
            if (model) {
                monaco.editor.setModelLanguage(model, selectedLanguage);
                GlobalCommandRunner.setLineState(
                    screenId,
                    lineId,
                    {
                        ...this.props.lineState,
                        lang: selectedLanguage,
                    },
                    false
                );
            }
        }
    };

    doSave = () => {
        if (!this.state.isSave) return;
        const { screenId, lineId } = this.props.context;
        const encodedCode = new TextEncoder().encode(this.state.code);
        GlobalModel.writeRemoteFile(screenId, lineId, this.filePath, encodedCode, { useTemp: true })
            .then(() => {
                this.originalData = this.state.code;
                this.setState({
                    isSave: false,
                    message: { status: "success", text: `Saved to ${this.props.cwd}/${this.filePath}` },
                });
                setTimeout(() => this.setState({ message: null }), 3000);
            })
            .catch((e) => {
                this.setState({ message: { status: "error", text: e.message } });
                setTimeout(() => this.setState({ message: null }), 3000);
            });
    };

    doClose = () => {
        if (this.state.isSave) return;
        const { screenId, lineId } = this.props.context;
        GlobalCommandRunner.setLineState(screenId, lineId, { ...this.props.lineState, "prompt:closed": true }, false)
            .then(() => {
                this.setState({
                    isClosed: true,
                    message: { status: "success", text: `Closed. This editor is now read-only` },
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
    };

    handleEditorChange = (code) => {
        SourceCodeRenderer.codeCache.set(this.cacheKey, code);
        this.setState({ code }, () => {
            this.setEditorHeight();
            this.props.data.text().then((originalCode) => this.setState({ isSave: code !== originalCode }));
        });
    };

    setEditorHeight = () => {
        const fullWindowHeight = parseInt(this.props.opts.maxSize.height);
        let _editorHeight = fullWindowHeight;
        if (this.props.readOnly || this.state.isClosed) {
            const noOfLines = Math.max(this.state.code.split("\n").length, 5);
            _editorHeight = Math.min(noOfLines * GlobalModel.termFontSize.get() * 1.5 + 10, fullWindowHeight);
        }
        this.setState({ editorHeight: _editorHeight }, () => this.props.scrollToBringIntoViewport());
    };

    render() {
        const { opts, exitcode, readOnly } = this.props;
        const { language, code, isSave, isClosed } = this.state;

        if (code == null)
            return <div className="renderer-container code-renderer" style={{ height: this.props.savedHeight }} />;

        if (exitcode === 1)
            return (
                <div
                    className="renderer-container code-renderer"
                    style={{
                        fontSize: GlobalModel.termFontSize.get(),
                        fontFamily: "JetBrains Mono",
                        color: "white",
                    }}
                >
                    {code}
                </div>
            );

        return (
            <div className="renderer-container code-renderer">
                <div className="scroller" style={{ maxHeight: opts.maxSize.height, paddingBottom: "15px" }}>
                    <Editor
                        theme="hc-black"
                        height={this.state.editorHeight}
                        defaultLanguage={language}
                        defaultValue={code}
                        onMount={this.handleEditorDidMount}
                        options={{
                            scrollBeyondLastLine: false,
                            fontSize: GlobalModel.termFontSize.get(),
                            fontFamily: "JetBrains Mono",
                            readOnly: readOnly || isClosed,
                            keybindings: [
                                {
                                    key: "ctrl+s",
                                    command: "-editor.action.filesave",
                                },
                                {
                                    key: "cmd+s",
                                    command: "-editor.action.filesave",
                                },
                            ],
                        }}
                        onChange={this.handleEditorChange}
                    />
                </div>
                <div style={{ position: "absolute", bottom: "-3px", right: 0 }}>
                    <select
                        className="dropdown"
                        value={this.state.selectedLanguage}
                        onChange={this.handleLanguageChange}
                        style={{ minWidth: "6rem", maxWidth: "6rem", marginRight: "26px" }}
                    >
                        {this.state.languages.map((lang, index) => (
                            <option key={index} value={lang}>
                                {lang}
                            </option>
                        ))}
                    </select>
                    {!readOnly && !isClosed && (
                        <div className="cmd-hints" style={{ minWidth: "6rem", maxWidth: "6rem", marginLeft: "-18px" }}>
                            <div
                                onClick={this.doSave}
                                className={`hint-item ${isSave ? "save-enabled" : "save-disabled"}`}
                            >
                                {`save (`}
                                {renderCmdText("S")}
                                {`)`}
                            </div>
                        </div>
                    )}
                    {!readOnly && !isClosed && (
                        <div className="cmd-hints" style={{ minWidth: "6rem", maxWidth: "6rem", marginLeft: "-18px" }}>
                            <div
                                onClick={this.doClose}
                                className={`hint-item ${!isSave ? "close-enabled" : "close-disabled"}`}
                            >
                                {`close (`}
                                {renderCmdText("D")}
                                {`)`}
                            </div>
                        </div>
                    )}
                </div>
                {this.state.message && (
                    <div style={{ position: "absolute", bottom: "-3px", left: "14px" }}>
                        <div
                            className="message"
                            style={{
                                fontSize: GlobalModel.termFontSize.get(),
                                fontFamily: "JetBrains Mono",
                                background: `${this.state.message.status === "error" ? "red" : "#4e9a06"}`,
                            }}
                        >
                            {this.state.message.text}
                        </div>
                    </div>
                )}
            </div>
        );
    }
}

export { SourceCodeRenderer };
