// Modified from https://github.com/sleeplessinc/cache/index.js
// Copyright 2017 Sleepless Software Inc. All rights reserved.

interface MemCacheItem<V = any> {
    expires: number;
    val: V;
}

export class MemCache<K, V> {
    ttl: number;
    data: Map<K, MemCacheItem<V>>;

    constructor(ttl = 0) {
        this.ttl = ttl || 0;
        this.data = new Map();
    }

    now() {
        return new Date().getTime();
    }

    get(key: K, cb: (arg0: V) => void = null) {
        let val = null;
        const obj = this.data.get(key);
        if (obj) {
            if (obj.expires == 0 || this.now() < obj.expires) {
                val = obj.val;
            } else {
                val = null;
                this.data.delete(key);
            }
        }
        if (cb) cb(val);
        return val;
    }

    put(key: K, val: V = null, ttl = 0, cb: (arg0: V) => void = null) {
        const ttlToUse = ttl == 0 ? this.ttl : ttl;
        const expires = ttlToUse == 0 ? 0 : this.now() + ttlToUse;
        const oldval = this.del(key);
        if (val !== null) {
            this.data.set(key, {
                expires,
                val,
            });
        }
        if (cb) cb(oldval);
        return oldval;
    }

    del(key: K, cb: (arg0: V) => void = null) {
        const oldval = this.get(key);
        this.data.delete(key);
        if (cb) cb(oldval);
        return oldval;
    }
}
