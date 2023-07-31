import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import type {RendererModelInitializeParams, TermOptsType, RendererContext, RendererOpts, SimpleBlobRendererComponent, RendererModelContainerApi, RendererPluginType, PtyDataType, RendererModel, RendererOptsUpdate, LineType, TermContextUnion, RendererContainerType} from "./types";
import {PacketDataBuffer} from "./ptydata";
import {debounce, throttle} from "throttle-debounce";

type OV<V> = mobx.IObservableValue<V>;
type CV<V> = mobx.IComputedValue<V>;

@mobxReact.observer
class FullRenderer extends React.Component<{rendererContainer : RendererContainerType, lineId : string, plugin : RendererPluginType, onHeightChange : () => void, initParams : RendererModelInitializeParams}, {}> {
    model : RendererModel;
    wrapperDivRef : React.RefObject<any> = React.createRef();
    rszObs : ResizeObserver;
    updateHeight_debounced : (newHeight : number) => void;

    constructor(props : any) {
        super(props);
        let {rendererContainer, lineId, plugin, initParams} = this.props;
        this.model = plugin.modelCtor();
        this.model.initialize(initParams);
        rendererContainer.registerRenderer(lineId, this.model);
        this.updateHeight_debounced = debounce(1000, this.updateHeight.bind(this));
    }

    updateHeight(newHeight : number) : void {
        this.model.updateHeight(newHeight);
    }

    handleResize(entries : ResizeObserverEntry[]) : void {
        if (this.props.onHeightChange) {
            this.props.onHeightChange();
        }
        if (this.wrapperDivRef.current != null) {
            let height = this.wrapperDivRef.current.offsetHeight;
            this.updateHeight_debounced(height);
        }
    }

    checkRszObs() {
        if (this.rszObs != null) {
            return;
        }
        if (this.wrapperDivRef.current == null) {
            return;
        }
        this.rszObs = new ResizeObserver(this.handleResize.bind(this));
        this.rszObs.observe(this.wrapperDivRef.current);
    }
    
    componentDidMount() {
        this.checkRszObs();
    }

    componentWillUnmount() {
        let {rendererContainer, lineId} = this.props;
        rendererContainer.unloadRenderer(lineId);
        if (this.rszObs != null) {
            this.rszObs.disconnect();
            this.rszObs = null;
        }
    }

    componentDidUpdate() {
        this.checkRszObs();
    }

    render() {
        let {plugin} = this.props;
        let Comp = plugin.fullComponent;
        if (Comp == null) {
            <div ref={this.wrapperDivRef}>
                (no component found in plugin)
            </div>
        }
        return (
            <div ref={this.wrapperDivRef}>
                <Comp model={this.model}/>
            </div>
        );
    }
}

export {FullRenderer};

