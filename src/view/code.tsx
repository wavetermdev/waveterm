import * as React from "react";
import { RendererContext, RendererOpts, LineStateType } from "../types";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner } from "../model";
import Split from "react-split-it";
import "./split.css";
import loader from "@monaco-editor/loader";
loader.config({ paths: { vs: "./node_modules/monaco-editor/min/vs" } });

function renderCmdText(text: string): any {
    return <span>&#x2318;{text}</span>;
}

// there is a global monaco variable (TODO get the correct TS type)
declare var monaco: any;

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
        isSelected: boolean;
        shouldFocus: boolean;
    },
    {
        code: string;
        languages: string[];
        selectedLanguage: string;
        isSave: boolean;
        isClosed: boolean;
        editorHeight: number;
        message: { status: string; text: string };
        isPreviewerAvailable: boolean;
    }
> {
    /**
     * codeCache is a Hashmap with key=screenId:lineId:filepath and value=code
     * Editor should never read the code directly from the filesystem. it should read from the cache.
     */
    static codeCache = new Map();

    // which languages have preview options
    languagesWithPreviewer = ["markdown", "html"];

    filePath;
    cacheKey;
    originalData;
    monacoEditor: any; // reference to mounted monaco editor.  TODO need the correct type
    markdownRef;
    syncing;

    constructor(props) {
        super(props);
        this.monacoEditor = null;
        const editorHeight = Math.max(props.savedHeight - 25, 0); // must subtract the padding/margin to get the real editorHeight
        this.markdownRef = React.createRef();
        this.syncing = false; // to avoid recursive calls between the two scroll listeners
        this.state = {
            code: null,
            languages: [],
            selectedLanguage: "",
            isSave: false,
            isClosed: false,
            editorHeight: editorHeight,
            message: null,
            isPreviewerAvailable: false,
        };
    }

    componentDidMount(): void {
        this.filePath = this.props.lineState["prompt:file"];
        const { screenId, lineId } = this.props.context;
        this.cacheKey = `${screenId}-${lineId}-${this.filePath}`;
        const code = SourceCodeRenderer.codeCache.get(this.cacheKey);
        if (code) {
            this.setState({ code, isClosed: this.props.lineState["prompt:closed"] });
        } else {
            this.props.data.text().then((code) => {
                this.originalData = code;
                this.setState({ code, isClosed: this.props.lineState["prompt:closed"] });
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

    handleEditorDidMount = (editor, monaco) => {
        this.monacoEditor = editor;
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
        editor.onDidScrollChange((e) => {
            if (!this.syncing && e.scrollTopChanged) {
                this.syncing = true;
                this.handleEditorScrollChange(e);
                this.syncing = false;
            }
        });
        if (this.props.shouldFocus) {
            this.monacoEditor.focus();
        }
    };

    handleEditorScrollChange(e) {
        // Get the maximum scrollable height for the editor
        const scrollableHeightEditor = this.monacoEditor.getScrollHeight() - this.monacoEditor.getLayoutInfo().height;

        // Calculate the scroll percentage
        const verticalScrollPercentage = e.scrollTop / scrollableHeightEditor;

        // Apply the same percentage to the markdown div
        const markdownDiv = this.markdownRef.current;
        const scrollableHeightMarkdown = markdownDiv.scrollHeight - markdownDiv.clientHeight;
        markdownDiv.scrollTop = verticalScrollPercentage * scrollableHeightMarkdown;
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

    handleLanguageChange = (event) => {
        const { screenId, lineId } = this.props.context;
        const selectedLanguage = event.target.value;
        this.setState({
            selectedLanguage,
            isPreviewerAvailable: this.languagesWithPreviewer.includes(selectedLanguage),
        });
        if (this.monacoEditor) {
            const model = this.monacoEditor.getModel();
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
        if (this.props.shouldFocus) {
            GlobalCommandRunner.screenSetFocus("input");
        }
    };

    handleEditorChange = (code) => {
        SourceCodeRenderer.codeCache.set(this.cacheKey, code);
        this.setState({ code }, () => {
            this.setEditorHeight();
            this.props.data.text().then((originalCode) => this.setState({ isSave: code !== originalCode }));
        });
    };

    setEditorHeight = () => {
        const fullWindowHeight = this.props.opts.maxSize.height;
        let _editorHeight = fullWindowHeight;
        let allowEditing = this.getAllowEditing();
        if (!allowEditing) {
            const noOfLines = Math.max(this.state.code.split("\n").length, 5);
            const lineHeight = Math.ceil(GlobalModel.termFontSize.get() * 1.5);
            _editorHeight = Math.min(noOfLines * lineHeight + 10, fullWindowHeight);
        }
        this.setState({ editorHeight: _editorHeight }, () => {
            if (this.props.isSelected) {
                this.props.scrollToBringIntoViewport();
            }
        });
    };

    getAllowEditing(): boolean {
        let lineState = this.props.lineState;
        let mode = lineState["mode"] || "view";
        if (mode == "view") {
            return false;
        }
        return !(this.props.readOnly || this.state.isClosed);
    }

    getCodeEditor = () => (
        <div style={{ maxHeight: this.props.opts.maxSize.height }}>
            <Editor
                theme="hc-black"
                height={this.state.editorHeight}
                defaultLanguage={this.state.selectedLanguage}
                defaultValue={this.state.code}
                onMount={this.handleEditorDidMount}
                options={{
                    scrollBeyondLastLine: false,
                    fontSize: GlobalModel.termFontSize.get(),
                    fontFamily: "JetBrains Mono",
                    readOnly: !this.getAllowEditing(),
                }}
                onChange={this.handleEditorChange}
            />
        </div>
    );

    getPreviewer = () => {
        function LinkRenderer(props: any): any {
            let newUrl = "https://extern?" + encodeURIComponent(props.href);
            return (
                <a href={newUrl} target="_blank">
                    {props.children}
                </a>
            );
        }

        function HeaderRenderer(props: any, hnum: number): any {
            return <div className={cn("title", "is-" + hnum)}>{props.children}</div>;
        }

        function CodeRenderer(props: any): any {
            return <code className={cn({ inline: props.inline })}>{props.children}</code>;
        }
        let markdownComponents = {
            a: LinkRenderer,
            h1: (props) => HeaderRenderer(props, 1),
            h2: (props) => HeaderRenderer(props, 2),
            h3: (props) => HeaderRenderer(props, 3),
            h4: (props) => HeaderRenderer(props, 4),
            h5: (props) => HeaderRenderer(props, 5),
            h6: (props) => HeaderRenderer(props, 6),
            code: CodeRenderer,
        };
        return (
            <div
                className="scroller"
                style={{ maxHeight: this.props.opts.maxSize.height }}
                ref={this.markdownRef}
                onScroll={() => this.handleDivScroll()}
            >
                <div className={"markdown content"} style={{ width: "100%", padding: "1rem" }}>
                    <ReactMarkdown
                        children={this.state.code}
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                    />
                </div>
            </div>
        );
    };

    getEditorControls = () => {
        const { selectedLanguage, isSave, languages } = this.state;
        let allowEditing = this.getAllowEditing();
        return (
            <div style={{ position: "absolute", bottom: "-3px", right: 0 }}>
                <select
                    className="dropdown"
                    value={selectedLanguage}
                    onChange={this.handleLanguageChange}
                    style={{ minWidth: "6rem", maxWidth: "6rem", marginRight: "26px" }}
                >
                    {languages.map((lang, index) => (
                        <option key={index} value={lang}>
                            {lang}
                        </option>
                    ))}
                </select>
                {allowEditing && (
                    <div className="cmd-hints" style={{ minWidth: "6rem", maxWidth: "6rem", marginLeft: "-18px" }}>
                        <div onClick={this.doSave} className={`hint-item ${isSave ? "save-enabled" : "save-disabled"}`}>
                            {`save (`}
                            {renderCmdText("S")}
                            {`)`}
                        </div>
                    </div>
                )}
                {allowEditing && (
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
        );
    };

    getMessage = () => (
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
    );

    render() {
        const { exitcode } = this.props;
        const { code, message, isPreviewerAvailable } = this.state;

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
                <Split>
                    {this.getCodeEditor()}
                    {isPreviewerAvailable && this.getPreviewer()}
                </Split>
                {this.getEditorControls()}
                {message && this.getMessage()}
            </div>
        );
    }
}

export { SourceCodeRenderer };
