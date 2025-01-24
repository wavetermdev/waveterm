// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { EventEmitter } from "events";

interface GlobalEvents {
    "windows-updated": () => void; // emitted whenever a window is opened/closed
}

class GlobalEventEmitter extends EventEmitter {
    emit<K extends keyof GlobalEvents>(event: K, ...args: Parameters<GlobalEvents[K]>): boolean {
        return super.emit(event, ...args);
    }

    on<K extends keyof GlobalEvents>(event: K, listener: GlobalEvents[K]): this {
        return super.on(event, listener);
    }

    once<K extends keyof GlobalEvents>(event: K, listener: GlobalEvents[K]): this {
        return super.once(event, listener);
    }

    off<K extends keyof GlobalEvents>(event: K, listener: GlobalEvents[K]): this {
        return super.off(event, listener);
    }
}

const globalEvents = new GlobalEventEmitter();

export { globalEvents };
