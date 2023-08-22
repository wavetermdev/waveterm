import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import { RendererContext, RendererOpts } from "../types";
import Editor from "@monaco-editor/react";

/**
 * Note: As mentioned in https://www.npmjs.com/package/@monaco-editor/react#for-electron-users,
 * Monaco gets loaded from CDN. This may be problematic if we are behind a firewall etc. If this happens,
 * We need to serve Monaco from node_modules instead
 */

type OV<V> = mobx.IObservableValue<V>;

const MaxJsonSize = 50000;

@mobxReact.observer
class SourceCodeRenderer extends React.Component<
    {
        data: Blob;
        path: String;
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
        const extension = this.props.cmdstr.split(".").pop();
        const detectedLanguage = monaco.languages
            .getLanguages()
            .find((lang) => lang.extensions && lang.extensions.includes("." + extension));
        if (detectedLanguage) {
            this.editorRef.current = editor;
            const model = editor.getModel();
            if (model) {
                monaco.editor.setModelLanguage(model, detectedLanguage.id);
                this.language.set(detectedLanguage.id);
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
            </div>
        );
    }
}

export { SourceCodeRenderer };
