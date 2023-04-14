import {RendererPluginType} from "./types";
import {SimpleImageRenderer} from "./view/image";
import {SimpleMarkdownRenderer} from "./view/markdown";
import {SimpleJsonRenderer} from "./view/json";
import {isBlank} from "./util";
import {sprintf} from "sprintf-js";

const ImagePlugin : RendererPluginType = {
    name: "image",
    rendererType: "simple",
    heightType: "pixels",
    dataType: "blob",
    collapseType: "hide",
    globalCss: null,
    mimeTypes: ["image/*"],
    component: SimpleImageRenderer,
};

const MarkdownPlugin : RendererPluginType = {
    name: "markdown",
    rendererType: "simple",
    heightType: "pixels",
    dataType: "blob",
    collapseType: "hide",
    globalCss: null,
    mimeTypes: ["text/markdown"],
    component: SimpleMarkdownRenderer,
};

const JsonPlugin : RendererPluginType = {
    name: "json",
    rendererType: "simple",
    heightType: "pixels",
    dataType: "blob",
    collapseType: "hide",
    globalCss: null,
    mimeTypes: ["application/json"],
    component: SimpleJsonRenderer,
};

class PluginModelClass {
    rendererPlugins : RendererPluginType[] = [];
    
    registerRendererPlugin(plugin : RendererPluginType) {
        if (isBlank(plugin.name)) {
            throw new Error("invalid plugin, no name");
        }
        if (plugin.name == "terminal" || plugin.name == "none") {
            throw new Error(sprintf("invalid plugin, name '%s' is reserved", plugin.name));
        }
        let existingPlugin = this.getRendererPluginByName(plugin.name);
        if (existingPlugin != null) {
            throw new Error(sprintf("plugin with name %s already registered", plugin.name));
        }
        this.rendererPlugins.push(plugin);
    }

    getRendererPluginByName(name : string) : RendererPluginType {
        for (let i=0; i<this.rendererPlugins.length; i++) {
            let plugin = this.rendererPlugins[i];
            if (plugin.name == name) {
                return plugin;
            }
        }
        return null;
    }
}

let PluginModel : PluginModelClass = null;
if ((window as any).PluginModel == null) {
    PluginModel = new PluginModelClass();
    PluginModel.registerRendererPlugin(ImagePlugin);
    PluginModel.registerRendererPlugin(MarkdownPlugin);
    PluginModel.registerRendererPlugin(JsonPlugin);
    (window as any).PluginModel = PluginModel;
}

export {PluginModel};
