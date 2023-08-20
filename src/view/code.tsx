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
class CodeRenderer extends React.Component<
  {
    data: Blob;
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

  componentDidMount() {
    let dataBlob = this.props.data;
    let prtn = dataBlob.text();
    prtn.then((text) => {
      this.code.set(text);
      const detectedLanguage = `javascript`;
      this.language.set(detectedLanguage);
      console.log(`1. ${detectedLanguage}\n\n${text}\n\n`);
    });
  }

  render() {
    let opts = this.props.opts;
    let maxWidth = opts.maxSize.width;
    let minWidth = opts.maxSize.width;
    if (minWidth > 1000) {
      minWidth = 1000;
    }
    let lang = this.language.get();
    let code = this.code.get();
    console.log(`2. ${lang}\n\n${code}\n\n`);
    if (!lang) return <></>;
    return (
      <div className="renderer-container json-renderer">
        <div className="scroller" style={{ maxHeight: opts.maxSize.height }}>
          <Editor
            height="30vh"
            theme="vs-dark"
            defaultLanguage={lang}
            defaultValue={code}
          />
        </div>
      </div>
    );
  }
}

export { CodeRenderer };
