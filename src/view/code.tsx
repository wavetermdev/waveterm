import * as React from "react";
import { RendererContext, RendererOpts, LineStateType } from "../types";
import Editor from "@monaco-editor/react";
import { GlobalModel } from "../model";

function renderCmdText(text: string): any {
    return <span>&#x2318;{text}</span>;
}

class SourceCodeRenderer extends React.Component<
    {
        data: Blob;
        cmdstr: string;
        cwd: string;
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
            code: "",
            language: "",
            languages: [],
            selectedLanguage: "",
            isSave: false,
            editorHeight: props.savedHeight,
            message: null,
        };
    }

    componentDidMount(): void {
        console.dir(this.props);
        this.filePath = this.props.lineState["prompt:file"];
        const { screenId, lineId } = this.props.context;
        this.cacheKey = `${screenId}-${lineId}-${this.filePath}`;
        const code = SourceCodeRenderer.codeCache.get(this.cacheKey);
        if (code) {
            this.setState({ code });
        } else
            this.props.data.text().then((code) => {
                this.originalData = code;
                this.setState({ code });
                SourceCodeRenderer.codeCache.set(this.cacheKey, code);
            });
    }

    handleEditorDidMount = (editor, monaco) => {
        // we try to grab the filename from with filePath (coming from lineState["prompt:file"]) or cmdstr
        const strForFilePath = this.filePath || this.props.cmdstr;
        const extension = strForFilePath.match(/(?:[^\\\/:*?"<>|\r\n]+\.)([a-zA-Z0-9]+)\b/)?.[1] || "";
        const detectedLanguage = monaco.languages
            .getLanguages()
            .find((lang) => lang.extensions?.includes("." + extension));
        const languages = monaco.languages.getLanguages().map((lang) => lang.id);
        this.setState({ languages });
        if (detectedLanguage) {
            this.editorRef.current = editor;
            const model = editor.getModel();
            if (model) {
                monaco.editor.setModelLanguage(model, detectedLanguage.id);
                this.setState({ selectedLanguage: detectedLanguage.id, language: detectedLanguage.id });
            }
        }
        this.setEditorHeight();
        editor.onKeyDown((e) => {
            if (e.code === "KeyS" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.doSave();
            }
        });
    };

    handleLanguageChange = (event) => {
        const selectedLanguage = event.target.value;
        this.setState({ selectedLanguage });
        if (this.editorRef.current) {
            const model = this.editorRef.current.getModel();
            if (model) {
                monaco.editor.setModelLanguage(model, selectedLanguage);
                this.setState({ language: selectedLanguage });
            }
        }
    };

    doSave = () => {
        const { screenId, lineId } = this.props.context;
        const encodedCode = new TextEncoder().encode(this.state.code);
        debugger;
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
        if (this.props.readOnly) {
            const noOfLines = this.state.code.split("\n").length;
            _editorHeight = Math.min(noOfLines * GlobalModel.termFontSize.get() * 1.5 + 10, fullWindowHeight);
        }
        this.setState({ editorHeight: _editorHeight }, () => this.props.scrollToBringIntoViewport());
    };

    render() {
        const { opts, exitcode } = this.props;
        const { lang, code, isSave } = this.state;

        if (!code)
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
                        defaultLanguage={lang}
                        defaultValue={code}
                        onMount={this.handleEditorDidMount}
                        options={{
                            scrollBeyondLastLine: false,
                            fontSize: GlobalModel.termFontSize.get(),
                            fontFamily: "JetBrains Mono",
                            readOnly: this.props.readOnly,
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
                    {!this.props.readOnly && (
                        <div className="cmd-hints" style={{ minWidth: "6rem", maxWidth: "6rem", marginLeft: "-18px" }}>
                            <div
                                onClick={this.doSave}
                                className={`hint-item ${isSave ? "save-enabled" : "save-disabled"}`}
                            >
                                {`save`} {renderCmdText("S")}
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
