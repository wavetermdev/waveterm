import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import { RendererContext, RendererOpts } from "../types";

import "./plugins.less";

type OV<V> = mobx.IObservableValue<V>;
type CV<V> = mobx.IComputedValue<V>;

// ctor(RendererContext, RenderOpts, isDone);
// type RendererModel = {
//     dispose : () => void,
//     reload : (delayMs : number) => void,
//     receiveData : (pos : number, data : Uint8Array, reason? : string) => void,
//     cmdDone : () => void,
//     resizeWindow : (size : WindowSize) => void,
//     resizeCols : (cols : number) => void,
//     giveFocus : () => void,
//     getUsedRows : () => number,
// };

// two types of renderers
//     JSON
//     blob
//

@mobxReact.observer
class SimpleImageRenderer extends React.Component<
    { data: Blob; context: RendererContext; opts: RendererOpts; savedHeight: number },
    {}
> {
    objUrl: string = null;
    imageRef: React.RefObject<any> = React.createRef();
    imageLoaded: OV<boolean> = mobx.observable.box(false, { name: "imageLoaded" });

    componentDidMount() {
        let img = this.imageRef.current;
        if (img == null) {
            return;
        }
        if (img.complete) {
            this.setImageLoaded();
            return;
        }
        img.onload = () => {
            this.setImageLoaded();
        };
    }

    setImageLoaded() {
        mobx.action(() => {
            this.imageLoaded.set(true);
        })();
    }

    componentWillUnmount() {
        if (this.objUrl != null) {
            URL.revokeObjectURL(this.objUrl);
        }
    }

    render() {
        let dataBlob = this.props.data;
        if (dataBlob == null || dataBlob.notFound) {
            return (
                <div className="renderer-container image-renderer" style={{ fontSize: this.props.opts.termFontSize }}>
                    <div className="load-error-text">
                        ERROR: file {dataBlob && dataBlob.name ? JSON.stringify(dataBlob.name) : ""} not found
                    </div>
                </div>
            );
        }
        if (this.objUrl == null) {
            this.objUrl = URL.createObjectURL(dataBlob);
        }
        let opts = this.props.opts;
        let forceHeight: number = null;
        if (!this.imageLoaded.get() && this.props.savedHeight >= 0) {
            forceHeight = this.props.savedHeight;
        }
        return (
            <div className="renderer-container image-renderer" style={{ height: forceHeight }}>
                <img
                    ref={this.imageRef}
                    style={{ maxHeight: opts.idealSize.height, maxWidth: opts.idealSize.width }}
                    src={this.objUrl}
                />
            </div>
        );
    }
}

export { SimpleImageRenderer };
