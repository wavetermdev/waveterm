// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "./global";

class NavigateModelType {
    handlers: Map<string, () => void> = new Map(); // id -> handler
    urls: string[] = [];

    constructor() {
        getApi().onNavigate(this.handleNavigate.bind(this));
        getApi().onIframeNavigate(this.handleIframeNavigate.bind(this));
    }

    handleContextMenuClick(e: any, id: string): void {
        let handler = this.handlers.get(id);
        if (handler) {
            handler();
        }
    }

    handleNavigate(url: string): void {
        console.log("Navigate to", url);
        this.urls.push(url);
    }

    handleIframeNavigate(url: string): void {
        console.log("Iframe navigate to", url);
        this.urls.push(url);
    }

    getUrls(): string[] {
        return this.urls;
    }
}

const NavigateModel = new NavigateModelType();

export { NavigateModel, NavigateModelType };
