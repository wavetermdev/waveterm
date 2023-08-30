import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import { RendererContext, RendererOpts } from "../types";
import Editor from "@monaco-editor/react";
import { GlobalModel } from "../model";

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class SourceCodeRenderer extends React.Component<
    {
        data: Blob;
        cmdstr: String;
        cwd: String;
        context: RendererContext;
        opts: RendererOpts;
        savedHeight: number;
        scrollToBringIntoViewport: () => void;
    },
    {}
> {
    code: OV<string> = mobx.observable.box("");
    language: OV<string> = mobx.observable.box("");
    languages: OV<string[]> = mobx.observable.box([]);
    selectedLanguage: OV<string> = mobx.observable.box("");
    isFullWindow: OV<boolean> = mobx.observable.box(false); // load this from opts
    editorHeight: OV<number> = mobx.observable.box(this.props.savedHeight); // load this from opts
    editorRef;
    resizeObserver;
    constructor(props) {
        super(props);
        this.editorRef = React.createRef();
    }

    componentDidMount() {
        let prtn = this.props.data.text();
        prtn.then((text) => this.code.set(text));
    }

    handleEditorDidMount = (editor, monaco) => {
        // Use a regular expression to match a filename with an extension
        const extension = this.props.cmdstr.match(/(?:[^\\\/:*?"<>|\r\n]+\.)([a-zA-Z0-9]+)\b/)?.[1] || "";
        const detectedLanguage = monaco.languages
            .getLanguages()
            .find((lang) => lang.extensions && lang.extensions.includes("." + extension));
        const languages = monaco.languages.getLanguages().map((lang) => lang.id);
        this.languages.set(languages);
        if (detectedLanguage) {
            this.selectedLanguage.set(detectedLanguage.id);
            this.editorRef.current = editor;
            const model = editor.getModel();
            if (model) {
                monaco.editor.setModelLanguage(model, detectedLanguage.id);
                this.language.set(detectedLanguage.id);
            }
        }
        this.setEditorHeight();
    };

    handleLanguageChange = (event) => {
        const selectedLanguage = event.target.value;
        this.selectedLanguage.set(selectedLanguage);
        if (this.editorRef.current) {
            const model = this.editorRef.current.getModel();
            if (model) {
                monaco.editor.setModelLanguage(model, selectedLanguage);
                this.language.set(selectedLanguage);
            }
        }
    };

    toggleFit = () => {
        this.isFullWindow.set(!this.isFullWindow.get());
        this.setEditorHeight();
        setTimeout(() => this.props.scrollToBringIntoViewport(), 350);
    };

    handleEditorChange = (value, event) => {
        // editing will always be in fullscreen
        this.isFullWindow.set(true);
        this.code.set(value);
        this.setEditorHeight();
        setTimeout(() => this.props.scrollToBringIntoViewport(), 350);
    };

    setEditorHeight = () => {
        const fullWindowHeight = parseInt(this.props.opts.maxSize.height);
        let _editorHeight = fullWindowHeight;
        console.log(`this.isFullWindow.get() = ${this.isFullWindow.get()} and _editorHeight = ${_editorHeight}`);
        if (!this.isFullWindow.get()) {
            console.log(`recalculating _editorHeight`);
            const noOfLines = this.code.get().split("\n").length;
            _editorHeight = Math.min(noOfLines * GlobalModel.termFontSize.get() * 1.5 + 10, fullWindowHeight);
        }
        this.editorHeight.set(_editorHeight);
    };

    render() {
        let opts = this.props.opts;
        let lang = this.language.get();
        let code = this.code.get();
        if (!code) {
            return <div className="renderer-container code-renderer" style={{ height: this.props.savedHeight }} />;
        }
        return (
            <div className="renderer-container code-renderer">
                <div className="scroller" style={{ maxHeight: opts.maxSize.height, paddingBottom: "15px" }}>
                    <Editor
                        theme="hc-black"
                        height={this.editorHeight.get()}
                        defaultLanguage={lang}
                        defaultValue={code}
                        onMount={this.handleEditorDidMount}
                        options={{
                            scrollBeyondLastLine: false,
                            fontSize: GlobalModel.termFontSize.get(),
                            fontFamily: "JetBrains Mono",
                            readOnly: this.props.opts.readOnly,
                        }}
                        onChange={this.handleEditorChange}
                    />
                </div>
                <div style={{ position: "absolute", bottom: "-3px", right: 0 }}>
                    <select
                        className="dropdown"
                        value={this.selectedLanguage.get()}
                        onChange={this.handleLanguageChange}
                        style={{ minWidth: "6rem", maxWidth: "6rem", marginRight: "8px" }}
                    >
                        {this.languages.get().map((lang, index) => (
                            <option key={index} value={lang}>
                                {lang}
                            </option>
                        ))}
                    </select>
                    <div className="cmd-hints" style={{ minWidth: "6rem", maxWidth: "6rem" }}>
                        <div onClick={this.toggleFit} className="hint-item color-white">
                            {this.isFullWindow.get() ? `shrink` : `expand`}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

export { SourceCodeRenderer };
