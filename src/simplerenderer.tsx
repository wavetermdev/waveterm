import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import type {RendererModelInitializeParams, TermOptsType, RendererContext, RendererOpts, SimpleBlobRendererComponent, RendererModelContainerApi, RendererPluginType, PtyDataType, RendererModel, RendererOptsUpdate, LineType, TermContextUnion, RendererContainerType} from "./types";
import {PtyDataBuffer} from "./ptydata";
import {debounce, throttle} from "throttle-debounce";

type OV<V> = mobx.IObservableValue<V>;
type CV<V> = mobx.IComputedValue<V>;

class SimpleBlobRendererModel {
    context : RendererContext;
    opts : RendererOpts;
    isDone : OV<boolean>;
    api : RendererModelContainerApi;
    savedHeight : number;
    loading : OV<boolean>;
    loadError : OV<string> = mobx.observable.box(null, {name: "renderer-loadError"});
    ptyData : PtyDataType;
    updateHeight_debounced : (newHeight : number) => void;
    ptyDataSource : (termContext : TermContextUnion) => Promise<PtyDataType>;
    
    constructor() {
        this.updateHeight_debounced = debounce(1000, this.updateHeight.bind(this));
    }

    initialize(params : RendererModelInitializeParams) : void {
        this.loading = mobx.observable.box(true, {name: "renderer-loading"});
        this.isDone = mobx.observable.box(params.isDone, {name: "renderer-isDone"});
        this.context = params.context;
        this.opts = params.opts;
        this.api = params.api;
        this.savedHeight = params.savedHeight;
        this.ptyDataSource = params.ptyDataSource;
        if (this.isDone.get()) {
            this.reload(0);
        }
    }

    dispose() : void {
        return;
    }
    
    giveFocus() : void {
        return;
    }

    updateOpts(update : RendererOptsUpdate) : void {
        Object.assign(this.opts, update);
    }

    updateHeight(newHeight : number) : void {
        if (this.savedHeight != newHeight) {
            this.savedHeight = newHeight;
            this.api.saveHeight(newHeight);
        }
    }
    
    setIsDone() : void {
        if (this.isDone.get()) {
            return;
        }
        mobx.action(() => {
            this.isDone.set(true);
        })();
        this.reload(0);
    }

    reload(delayMs : number) : void {
        mobx.action(() => {
            this.loading.set(true);
        })();
        let rtnp = this.ptyDataSource(this.context);
        rtnp.then((ptydata) => {
            setTimeout(() => {
                this.ptyData = ptydata;
                mobx.action(() => {
                    this.loading.set(false);
                    this.loadError.set(null);
                })();
            }, delayMs);
        }).catch((e) => {
            console.log("error loading data", e);
            mobx.action(() => {
                this.loadError.set("error loading data: " + e);
            })();
        });
    }
    
    receiveData(pos : number, data : Uint8Array, reason? : string) : void {
        // this.dataBuf.receiveData(pos, data, reason);
    }
}

@mobxReact.observer
class SimpleBlobRenderer extends React.Component<{rendererContainer : RendererContainerType, cmdId : string, plugin : RendererPluginType, onHeightChange : () => void, initParams : RendererModelInitializeParams}, {}> {
    model : SimpleBlobRendererModel;
    wrapperDivRef : React.RefObject<any> = React.createRef();
    rszObs : ResizeObserver;

    constructor(props : any) {
        super(props);
        let {rendererContainer, cmdId, initParams} = this.props;
        this.model = new SimpleBlobRendererModel();
        this.model.initialize(initParams);
        rendererContainer.registerRenderer(cmdId, this.model);
    }

    handleResize(entries : ResizeObserverEntry[]) : void {
        if (this.model.loading.get()) {
            return;
        }
        if (this.props.onHeightChange) {
            this.props.onHeightChange();
        }
        if (!this.model.loading.get() && this.wrapperDivRef.current != null) {
            let height = this.wrapperDivRef.current.offsetHeight;
            this.model.updateHeight_debounced(height);
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
        let {rendererContainer, cmdId} = this.props;
        rendererContainer.unloadRenderer(cmdId);
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
        let model = this.model;
        if (model.loading.get()) {
            let height = this.model.savedHeight;
            return (<div ref={this.wrapperDivRef} style={{minHeight: height}}>...</div>);
        }
        let Comp = plugin.component;
        let dataBlob = new Blob([model.ptyData.data]);
        return (
            <div ref={this.wrapperDivRef}>
                <Comp data={dataBlob} context={model.context} opts={model.opts} savedHeight={this.model.savedHeight}/>
            </div>
        );
    }
}

export {SimpleBlobRendererModel, SimpleBlobRenderer};

