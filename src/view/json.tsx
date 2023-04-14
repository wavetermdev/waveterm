import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import cn from "classnames";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import {WindowSize, RendererContext, TermOptsType, LineType, RendererOpts} from "../types";
import {sprintf} from "sprintf-js";
import {Markdown} from "../elements";
import ReactJson from "react-json-view";

type OV<V> = mobx.IObservableValue<V>;

const MaxJsonSize = 50000;

@mobxReact.observer
class SimpleJsonRenderer extends React.Component<{data : Blob, context : RendererContext, opts : RendererOpts, savedHeight : number}, {}> {
    jsonObj : OV<any> = mobx.observable.box(null, {name: "jsonObj", deep: false});
    jsonError : OV<string> = mobx.observable.box(null, {name: "jsonError"});

    setJsonError(err : string) {
        mobx.action(() => {
            this.jsonError.set(err);
        })();
    }

    componentDidMount() {
        let dataBlob = this.props.data;
        if (dataBlob.size > MaxJsonSize) {
            this.setJsonError(sprintf("error: json too large to render size=%d", dataBlob.size));
            return;
        }
        let prtn = dataBlob.text()
        prtn.then((text) => {
            if (/[\x00-\x08]/.test(text)) {
                this.setJsonError(sprintf("error: not rendering json, binary characters detected"));
                return;
            }
            try {
                let obj = JSON.parse(text);
                mobx.action(() => {
                    this.jsonObj.set(obj);
                })();
            }
            catch (e) {
                this.setJsonError(sprintf("error: JSON parse error: %s", e.message));
            }
        });
    }
    
    render() {
        if (this.jsonError.get() != null) {
            return <div className="renderer-container json-renderer"><div className="error-container">{this.jsonError.get()}</div></div>;
        }
        if (this.jsonObj.get() == null) {
            return <div className="renderer-container json-renderer" style={{height: this.props.savedHeight}}/>
        }
        let opts = this.props.opts;
        let maxWidth = opts.maxSize.width;
        let minWidth = opts.maxSize.width;
        if (minWidth > 1000) {
            minWidth = 1000;
        }
        return (
            <div className="renderer-container json-renderer">
                <div className="scroller" style={{maxHeight: opts.maxSize.height}}>
                    <ReactJson src={this.jsonObj.get()} theme="monokai" style={{backgroundColor: "black"}} displayDataTypes={false} quotesOnKeys={false} sortKeys={true}/>
                </div>
            </div>
        );
    }
}

export {SimpleJsonRenderer};
