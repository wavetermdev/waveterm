// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0s

import base64 from "base64-js";
import clsx from "clsx";
import { Atom, atom, Getter, SetStateAction, Setter, useAtomValue } from "jotai";
import { debounce, throttle } from "throttle-debounce";
const prevValueCache = new WeakMap<any, any>(); // stores a previous value for a deep equal comparison (used with the deepCompareReturnPrev function)

function isBlank(str: string): boolean {
    return str == null || str == "";
}

function base64ToString(b64: string): string {
    if (b64 == null) {
        return null;
    }
    if (b64 == "") {
        return "";
    }
    const stringBytes = base64.toByteArray(b64);
    return new TextDecoder().decode(stringBytes);
}

function stringToBase64(input: string): string {
    const stringBytes = new TextEncoder().encode(input);
    return base64.fromByteArray(stringBytes);
}

function base64ToArray(b64: string): Uint8Array {
    const rawStr = atob(b64);
    const rtnArr = new Uint8Array(new ArrayBuffer(rawStr.length));
    for (let i = 0; i < rawStr.length; i++) {
        rtnArr[i] = rawStr.charCodeAt(i);
    }
    return rtnArr;
}

function boundNumber(num: number, min: number, max: number): number {
    if (num == null || typeof num != "number" || isNaN(num)) {
        return null;
    }
    return Math.min(Math.max(num, min), max);
}

// key must be a suitable weakmap key.  pass the new value
// it will return the prevValue (for object equality) if the new value is deep equal to the prev value
function deepCompareReturnPrev(key: any, newValue: any): any {
    if (key == null) {
        return newValue;
    }
    const previousValue = prevValueCache.get(key);
    if (previousValue !== undefined && JSON.stringify(newValue) === JSON.stringify(previousValue)) {
        return previousValue;
    }
    prevValueCache.set(key, newValue);
    return newValue;
}

// works for json-like objects (arrays, objects, strings, numbers, booleans)
function jsonDeepEqual(v1: any, v2: any): boolean {
    if (v1 === v2) {
        return true;
    }
    if (typeof v1 !== typeof v2) {
        return false;
    }
    if ((v1 == null && v2 != null) || (v1 != null && v2 == null)) {
        return false;
    }
    if (typeof v1 === "object") {
        if (Array.isArray(v1) && Array.isArray(v2)) {
            if (v1.length !== v2.length) {
                return false;
            }
            for (let i = 0; i < v1.length; i++) {
                if (!jsonDeepEqual(v1[i], v2[i])) {
                    return false;
                }
            }
            return true;
        } else {
            const keys1 = Object.keys(v1);
            const keys2 = Object.keys(v2);
            if (keys1.length !== keys2.length) {
                return false;
            }
            for (let key of keys1) {
                if (!jsonDeepEqual(v1[key], v2[key])) {
                    return false;
                }
            }
            return true;
        }
    }
    return false;
}

function makeIconClass(icon: string, fw: boolean, opts?: { spin?: boolean; defaultIcon?: string }): string {
    if (isBlank(icon)) {
        if (opts?.defaultIcon != null) {
            return makeIconClass(opts.defaultIcon, fw, { spin: opts?.spin });
        }
        return null;
    }
    if (icon.match(/^(solid@)?[a-z0-9-]+$/)) {
        // strip off "solid@" prefix if it exists
        icon = icon.replace(/^solid@/, "");
        return clsx(`fa fa-solid fa-${icon}`, fw ? "fa-fw" : null, opts?.spin ? "fa-spin" : null);
    }
    if (icon.match(/^regular@[a-z0-9-]+$/)) {
        // strip off the "regular@" prefix if it exists
        icon = icon.replace(/^regular@/, "");
        return clsx(`fa fa-sharp fa-regular fa-${icon}`, fw ? "fa-fw" : null, opts?.spin ? "fa-spin" : null);
    }
    if (icon.match(/^brands@[a-z0-9-]+$/)) {
        // strip off the "brands@" prefix if it exists
        icon = icon.replace(/^brands@/, "");
        return clsx(`fa fa-brands fa-${icon}`, fw ? "fa-fw" : null, opts?.spin ? "fa-spin" : null);
    }
    if (icon.match(/^custom@[a-z0-9-]+$/)) {
        // strip off the "custom@" prefix if it exists
        icon = icon.replace(/^custom@/, "");
        return clsx(`fa fa-kit fa-${icon}`, fw ? "fa-fw" : null, opts?.spin ? "fa-spin" : null);
    }
    if (opts?.defaultIcon != null) {
        return makeIconClass(opts.defaultIcon, fw, { spin: opts?.spin });
    }
    return null;
}

/**
 * A wrapper function for running a promise and catching any errors
 * @param f The promise to run
 */
function fireAndForget(f: () => Promise<any>) {
    f()?.catch((e) => {
        console.log("fireAndForget error", e);
    });
}

const promiseWeakMap = new WeakMap<Promise<any>, ResolvedValue<any>>();

type ResolvedValue<T> = {
    pending: boolean;
    error: any;
    value: T;
};

// returns the value, pending state, and error of a promise
function getPromiseState<T>(promise: Promise<T>): [T, boolean, any] {
    if (promise == null) {
        return [null, false, null];
    }
    if (promiseWeakMap.has(promise)) {
        const value = promiseWeakMap.get(promise);
        return [value.value, value.pending, value.error];
    }
    const value: ResolvedValue<T> = {
        pending: true,
        error: null,
        value: null,
    };
    promise.then(
        (result) => {
            value.pending = false;
            value.error = null;
            value.value = result;
        },
        (error) => {
            value.pending = false;
            value.error = error;
        }
    );
    promiseWeakMap.set(promise, value);
    return [value.value, value.pending, value.error];
}

// returns the value of a promise, or a default value if the promise is still pending (or had an error)
function getPromiseValue<T>(promise: Promise<T>, def: T): T {
    const [value, pending, error] = getPromiseState(promise);
    if (pending || error) {
        return def;
    }
    return value;
}

function jotaiLoadableValue<T>(value: Loadable<T>, def: T): T {
    if (value.state === "hasData") {
        return value.data;
    }
    return def;
}

const NullAtom = atom(null);

function useAtomValueSafe<T>(atom: Atom<T> | Atom<Promise<T>>): T {
    if (atom == null) {
        return useAtomValue(NullAtom) as T;
    }
    return useAtomValue(atom);
}

/**
 * Simple wrapper function that lazily evaluates the provided function and caches its result for future calls.
 * @param callback The function to lazily run.
 * @returns The result of the function.
 */
const lazy = <T extends (...args: any[]) => any>(callback: T) => {
    let res: ReturnType<T>;
    let processed = false;
    return (...args: Parameters<T>): ReturnType<T> => {
        if (processed) return res;
        res = callback(...args);
        processed = true;
        return res;
    };
};

/**
 * Generates an external link by appending the given URL to the "https://extern?" endpoint.
 *
 * @param {string} url - The URL to be encoded and appended to the external link.
 * @return {string} The generated external link.
 */
function makeExternLink(url: string): string {
    return "https://extern?" + encodeURIComponent(url);
}

function atomWithThrottle<T>(initialValue: T, delayMilliseconds = 500): AtomWithThrottle<T> {
    // DO NOT EXPORT currentValueAtom as using this atom to set state can cause
    // inconsistent state between currentValueAtom and throttledValueAtom
    const _currentValueAtom = atom(initialValue);

    const throttledValueAtom = atom(initialValue, (get, set, update: SetStateAction<T>) => {
        const prevValue = get(_currentValueAtom);
        const nextValue = typeof update === "function" ? (update as (prev: T) => T)(prevValue) : update;
        set(_currentValueAtom, nextValue);
        throttleUpdate(get, set);
    });

    const throttleUpdate = throttle(delayMilliseconds, (get: Getter, set: Setter) => {
        const curVal = get(_currentValueAtom);
        set(throttledValueAtom, curVal);
    });

    return {
        currentValueAtom: atom((get) => get(_currentValueAtom)),
        throttledValueAtom,
    };
}

function atomWithDebounce<T>(initialValue: T, delayMilliseconds = 500): AtomWithDebounce<T> {
    // DO NOT EXPORT currentValueAtom as using this atom to set state can cause
    // inconsistent state between currentValueAtom and debouncedValueAtom
    const _currentValueAtom = atom(initialValue);

    const debouncedValueAtom = atom(initialValue, (get, set, update: SetStateAction<T>) => {
        const prevValue = get(_currentValueAtom);
        const nextValue = typeof update === "function" ? (update as (prev: T) => T)(prevValue) : update;
        set(_currentValueAtom, nextValue);
        debounceUpdate(get, set);
    });

    const debounceUpdate = debounce(delayMilliseconds, (get: Getter, set: Setter) => {
        const curVal = get(_currentValueAtom);
        set(debouncedValueAtom, curVal);
    });

    return {
        currentValueAtom: atom((get) => get(_currentValueAtom)),
        debouncedValueAtom,
    };
}

function getPrefixedSettings(settings: SettingsType, prefix: string): SettingsType {
    const rtn: SettingsType = {};
    if (settings == null || isBlank(prefix)) {
        return rtn;
    }
    for (const key in settings) {
        if (key == prefix || key.startsWith(prefix + ":")) {
            rtn[key] = settings[key];
        }
    }
    return rtn;
}

function countGraphemes(str: string): number {
    if (str == null) {
        return 0;
    }
    // this exists (need to hack TS to get it to not show an error)
    const seg = new (Intl as any).Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(seg.segment(str)).length;
}

function makeConnRoute(conn: string): string {
    if (isBlank(conn)) {
        return "conn:local";
    }
    return "conn:" + conn;
}

export {
    atomWithDebounce,
    atomWithThrottle,
    base64ToArray,
    base64ToString,
    boundNumber,
    countGraphemes,
    deepCompareReturnPrev,
    fireAndForget,
    getPrefixedSettings,
    getPromiseState,
    getPromiseValue,
    isBlank,
    jotaiLoadableValue,
    jsonDeepEqual,
    lazy,
    makeConnRoute,
    makeExternLink,
    makeIconClass,
    stringToBase64,
    useAtomValueSafe,
};
