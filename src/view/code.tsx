import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import { RendererContext, RendererOpts } from "../types";
import Editor from "@monaco-editor/react";

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
    },
    {}
> {
    code: OV<any> = mobx.observable.box(null, {
        name: "code",
        deep: false,
    });
    language: OV<any> = mobx.observable.box(null, {
        name: "language",
        deep: false,
    });
    languages: OV<string[]> = mobx.observable.box([]);
    selectedLanguage: OV<string> = mobx.observable.box("");

    editorRef;
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

    render() {
        let opts = this.props.opts;
        let maxWidth = opts.maxSize.width;
        let minWidth = opts.maxSize.width;
        if (minWidth > 1000) {
            minWidth = 1000;
        }
        let lang = this.language.get();
        let code = this.code.get();
        if (!code) return <></>;
        return (
            <div className="renderer-container code-renderer">
                <div className="scroller" style={{ maxHeight: opts.maxSize.height }}>
                    <Editor
                        height="30vh"
                        theme="hc-black"
                        defaultLanguage={lang}
                        defaultValue={code}
                        onMount={this.handleEditorDidMount}
                        options={{
                            scrollBeyondLastLine: false,
                            fontSize: "14px",
                        }}
                    />
                </div>
                <div style={{ position: "absolute", bottom: "-3px", right: 0 }}>
                    <select
                        className="dropdown"
                        value={this.selectedLanguage.get()}
                        onChange={this.handleLanguageChange}
                        style={{ maxWidth: "5rem", marginRight: "24px" }}
                    >
                        {this.languages.get().map((lang, index) => (
                            <option key={index} value={lang}>
                                {lang}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
        );
    }
}

export { SourceCodeRenderer };
