// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RendererPluginType } from "../types/types";
import { SimpleImageRenderer } from "./image/image";
import { SimpleMarkdownRenderer } from "./markdown/markdown";
import { SourceCodeRenderer } from "./code/code";
import { SimpleMustacheRenderer } from "./mustache/mustache";
import { CSVRenderer } from "./csv/csv";
import { OpenAIRenderer, OpenAIRendererModel } from "./openai/openai";
import { isBlank } from "../util/util";
import { sprintf } from "sprintf-js";

// TODO: @mike - I did refactoring with the though that I can move config out of this plugins.ts file to a
// plugins.json file. This way, adding a new plugin would reuire adding an entry to the json config. At a later
// stage, a plugin can become a self-contained-bundle, which would have my_plugin.json into it. it will be easy to
// merge this my_plugin.json into the big plugins.json. I got stuck while defining 'simpleComponent: SimpleImageRenderer'
// in a json definition (something like Java.Reflection can be used to compose a class from its name. will try later)
const PluginConfigs: RendererPluginType[] = [
    {
        name: "markdown",
        rendererType: "simple",
        heightType: "pixels",
        dataType: "blob",
        collapseType: "hide",
        globalCss: null,
        mimeTypes: ["text/markdown"],
        simpleComponent: SimpleMarkdownRenderer,
    },
    {
        name: "mustache",
        rendererType: "simple",
        heightType: "pixels",
        dataType: "blob",
        collapseType: "hide",
        globalCss: null,
        mimeTypes: ["text/plain"],
        simpleComponent: SimpleMustacheRenderer,
    },
    {
        name: "code",
        rendererType: "simple",
        heightType: "pixels",
        dataType: "blob",
        collapseType: "hide",
        globalCss: null,
        mimeTypes: ["text/plain"],
        simpleComponent: SourceCodeRenderer,
    },
    {
        name: "openai",
        rendererType: "full",
        heightType: "pixels",
        dataType: "model",
        collapseType: "remove",
        hidePrompt: true,
        globalCss: null,
        mimeTypes: ["application/json"],
        fullComponent: OpenAIRenderer,
        modelCtor: () => new OpenAIRendererModel(),
    },
    {
        name: "csv",
        rendererType: "simple",
        heightType: "pixels",
        dataType: "blob",
        collapseType: "hide",
        globalCss: null,
        mimeTypes: ["text/csv"],
        simpleComponent: CSVRenderer,
    },
    {
        name: "image",
        rendererType: "simple",
        heightType: "pixels",
        dataType: "blob",
        collapseType: "hide",
        globalCss: null,
        mimeTypes: ["image/*"],
        simpleComponent: SimpleImageRenderer,
    },
];

class PluginModelClass {
    rendererPlugins: RendererPluginType[] = [];

    constructor(pluginConfigs: RendererPluginType[]) {
        this.rendererPlugins = pluginConfigs.map((plugin: RendererPluginType): RendererPluginType => {
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
            this.loadPluginResources(plugin);
            return plugin;
        });
    }

    // attach all screenshots. webpack doesnt allow dynamic paths, hence, we have to put static paths for each plugin
    attachScreenshots(plugin) {
        let screenshotsContext;
        let imagePaths = [];
        try {
            switch (plugin.name) {
                case "image":
                    screenshotsContext = require.context(`../plugins/image/screenshots`, false, /\.(png|jpe?g|gif)$/);
                    break;
                case "markdown":
                    screenshotsContext = require.context(
                        `../plugins/markdown/screenshots`,
                        false,
                        /\.(png|jpe?g|gif)$/
                    );
                    break;
                case "mustache":
                    screenshotsContext = require.context(
                        `../plugins/mustache/screenshots`,
                        false,
                        /\.(png|jpe?g|gif)$/
                    );
                    break;
                case "code":
                    screenshotsContext = require.context(`../plugins/code/screenshots`, false, /\.(png|jpe?g|gif)$/);
                    break;
                case "openai":
                    screenshotsContext = require.context(`../plugins/openai/screenshots`, false, /\.(png|jpe?g|gif)$/);
                    break;
                case "csv":
                    screenshotsContext = require.context(`../plugins/csv/screenshots`, false, /\.(png|jpe?g|gif)$/);
                    break;
                default:
                    return;
            }
            imagePaths = screenshotsContext.keys().map(screenshotsContext);
        } catch (error) {
            // this is no longer an error.  we don't need to require screenshots
        }
        plugin.screenshots = imagePaths.map((path) => path.default);
    }

    // use dynamic import to attach the icon etc. ensure that the 'name' matches the dir the plugin is in
    async loadPluginResources(plugin) {
        this.attachScreenshots(plugin);
        // attach other resources, these show an error because all plugins should have an icon, readme, and meta
        const handleImportError = (error, resourceType) =>
            console.error(`Failed to load ${resourceType} for plugin ${plugin.name}`);
        const iconPromise = import(`../plugins/${plugin.name}/icon.svg`)
            .then((icon) => (plugin.iconComp = icon.ReactComponent))
            .catch((error) => handleImportError(error, "icon"));
        const readmePromise = import(`../plugins/${plugin.name}/readme.md`)
            .then((content) => (plugin.readme = content.default))
            .catch((error) => handleImportError(error, "readme"));
        const metaPromise = import(`../plugins/${plugin.name}/meta.json`)
            .then((json) => Object.assign(plugin, json))
            .catch((error) => handleImportError(error, "meta"));
        return Promise.allSettled([iconPromise, readmePromise, metaPromise]);
    }

    getRendererPluginByName(name: string): RendererPluginType {
        for (let i = 0; i < this.rendererPlugins.length; i++) {
            let plugin = this.rendererPlugins[i];
            if (plugin.name == name) {
                return plugin;
            }
        }
        return null;
    }

    allPlugins() {
        return this.rendererPlugins;
    }
}

let PluginModel: PluginModelClass = null;
if ((window as any).PluginModel == null) {
    PluginModel = new PluginModelClass(PluginConfigs);
    (window as any).PluginModel = PluginModel;
}

export { PluginModel };
