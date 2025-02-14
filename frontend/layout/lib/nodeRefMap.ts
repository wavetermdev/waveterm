// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export class NodeRefMap {
    private map: Map<string, React.RefObject<HTMLDivElement>> = new Map();
    generation: number = 0;

    set(id: string, ref: React.RefObject<HTMLDivElement>) {
        this.map.set(id, ref);
        this.generation++;
    }

    delete(id: string) {
        if (this.map.has(id)) {
            this.map.delete(id);
            this.generation++;
        }
    }

    get(id: string): React.RefObject<HTMLDivElement> {
        if (this.map.has(id)) {
            return this.map.get(id);
        }
    }
}
