// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0s

import base64 from "base64-js";
import clsx from "clsx";
import * as jotai from "jotai";

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

function makeIconClass(icon: string, fw: boolean): string {
    if (icon == null) {
        return null;
    }
    if (icon.match(/^(solid@)?[a-z0-9-]+$/)) {
        // strip off "solid@" prefix if it exists
        icon = icon.replace(/^solid@/, "");
        return clsx(`fa fa-sharp fa-solid fa-${icon}`, fw ? "fa-fw" : null);
    }
    if (icon.match(/^regular@[a-z0-9-]+$/)) {
        // strip off the "regular@" prefix if it exists
        icon = icon.replace(/^regular@/, "");
        return clsx(`fa fa-sharp fa-regular fa-${icon}`, fw ? "fa-fw" : null);
    }
    return null;
}

/**
 * A wrapper function for running a promise and catching any errors
 * @param f The promise to run
 */
function fireAndForget(f: () => Promise<any>) {
    f().catch((e) => {
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

const NullAtom = jotai.atom(null);

function useAtomValueSafe<T>(atom: jotai.Atom<T>): T {
    if (atom == null) {
        return jotai.useAtomValue(NullAtom) as T;
    }
    return jotai.useAtomValue(atom);
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
 * Workaround for NodeJS compatibility. Will attempt to resolve the Crypto API from the browser and fallback to NodeJS if it isn't present.
 * @returns The Crypto API.
 */
function getCrypto() {
    try {
        return window.crypto;
    } catch {
        return crypto;
    }
}

export {
    base64ToArray,
    base64ToString,
    boundNumber,
    fireAndForget,
    getCrypto,
    getPromiseState,
    getPromiseValue,
    isBlank,
    jotaiLoadableValue,
    jsonDeepEqual,
    lazy,
    makeIconClass,
    stringToBase64,
    useAtomValueSafe,
};
