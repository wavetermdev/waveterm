import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import cn from "classnames";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import {WindowSize, RendererContext, TermOptsType, LineType, RendererOpts} from "./types";
import {getPtyData, termWidthFromCols, termHeightFromRows, GlobalModel, LineContainerModel} from "./model";
import {incObs} from "./util";
import {PtyDataBuffer} from "./ptydata";

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
class SimpleImageRenderer extends React.Component<{data : Blob, context : RendererContext, opts : RendererOpts}, {}> {
    objUrl : string = null;

    componentWillUnmount() {
        if (this.objUrl != null) {
            URL.revokeObjectURL(this.objUrl);
        }
    }
    
    render() {
        if (this.objUrl == null) {
            let dataBlob = this.props.data;
            this.objUrl = URL.createObjectURL(dataBlob);
        }
        let opts = this.props.opts;
        return (
            <div className="simple-image-renderer">
                <img style={{maxHeight: opts.idealSize.height, maxWidth: opts.idealSize.width}} src={this.objUrl}/>
            </div>
        );
    }
}

export {SimpleImageRenderer};

