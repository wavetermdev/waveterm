// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Inspired by https://github.com/sleeplessinc/cache/index.js
// Copyright 2017 Sleepless Software Inc. All rights reserved.
// SPDX-License-Identifier: ISC

import dayjs, { Dayjs } from "dayjs";
import duration, { Duration } from "dayjs/plugin/duration";

dayjs.extend(duration);

interface MemCacheItem<V = any> {
    expires: Dayjs;
    val: V;
}

export class MemCache<K, V> {
    ttl: Duration;
    data: Map<string, MemCacheItem<V>>;
    _timeout: NodeJS.Timeout;

    constructor(ttl = 0) {
        this.ttl = dayjs.duration(ttl, "ms");
        this.data = new Map();
    }

    hash(key: K) {
        return JSON.stringify(key);
    }

    get(key: K) {
        const hashKey = this.hash(key);
        let val = null;
        const obj = this.data.get(hashKey);
        if (obj) {
            if (dayjs() < obj.expires) {
                val = obj.val;
            } else {
                val = null;
                this.data.delete(hashKey);
            }
        }
        return val;
    }

    put(key: K, val: V = null, ttl = 0) {
        const ttlToUse = ttl == 0 ? this.ttl : dayjs.duration(ttl, "ms");
        const expires = dayjs().add(ttlToUse);
        if (val !== null) {
            this.data.set(this.hash(key), {
                expires,
                val,
            });
            this.schedulePurge();
        }
    }

    schedulePurge() {
        if (!this._timeout) {
            this._timeout = setTimeout(() => {
                this.purge();
                this._timeout = null;
            }, this.ttl.asMilliseconds());
        }
    }

    purge() {
        const now = dayjs();
        this.data.forEach((v, k) => {
            if (now >= v.expires) {
                this.data.delete(k);
            }
        });
    }
}
