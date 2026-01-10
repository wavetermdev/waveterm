// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0s

import base64 from "base64-js";
import clsx, { type ClassValue } from "clsx";
import { Atom, atom, Getter, SetStateAction, Setter, useAtomValue } from "jotai";
import { twMerge } from "tailwind-merge";
import { debounce, throttle } from "throttle-debounce";
const prevValueCache = new WeakMap<any, any>(); // stores a previous value for a deep equal comparison (used with the deepCompareReturnPrev function)

function isBlank(str: string): boolean {
    return str == null || str == "";
}

function isLocalConnName(connName: string): boolean {
    if (isBlank(connName)) {
        return true;
    }
    return connName === "local" || connName.startsWith("local:");
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

function arrayToBase64(input: Uint8Array): string {
    return base64.fromByteArray(input);
}

function base64ToArray(b64: string): Uint8Array<ArrayBufferLike> {
    const cleanB64 = b64.replace(/\s+/g, "");
    return base64.toByteArray(cleanB64);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
    const cleanB64 = b64.replace(/\s+/g, "");
    const u8 = base64.toByteArray(cleanB64); // Uint8Array<ArrayBufferLike>
    // Force a plain ArrayBuffer slice (no SharedArrayBuffer, no offset issues)
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
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

    let animation: string | null = null;
    let hasFwModifier = false;

    while (icon.match(/\+(spin|beat|fade|fw)$/)) {
        const modifierMatch = icon.match(/\+(spin|beat|fade|fw)$/);
        if (modifierMatch) {
            const modifier = modifierMatch[1];
            if (modifier === "fw") {
                hasFwModifier = true;
            } else {
                animation = modifier;
            }
            icon = icon.replace(/\+(spin|beat|fade|fw)$/, "");
        }
    }

    let baseClass: string;
    if (icon.match(/^(solid@)?[a-z0-9-]+$/)) {
        icon = icon.replace(/^solid@/, "");
        baseClass = `fa fa-solid fa-${icon}`;
    } else if (icon.match(/^regular@[a-z0-9-]+$/)) {
        icon = icon.replace(/^regular@/, "");
        baseClass = `fa fa-sharp fa-regular fa-${icon}`;
    } else if (icon.match(/^brands@[a-z0-9-]+$/)) {
        icon = icon.replace(/^brands@/, "");
        baseClass = `fa fa-brands fa-${icon}`;
    } else if (icon.match(/^custom@[a-z0-9-]+$/)) {
        icon = icon.replace(/^custom@/, "");
        baseClass = `fa fa-kit fa-${icon}`;
    } else {
        if (opts?.defaultIcon != null) {
            return makeIconClass(opts.defaultIcon, fw, { spin: opts?.spin });
        }
        return null;
    }

    const shouldAddFw = fw || hasFwModifier;
    const hasSpin = animation === "spin" || opts?.spin;
    const animationClass = animation && animation !== "spin" ? `fa-${animation}` : null;

    return clsx(baseClass, shouldAddFw ? "fa-fw" : null, hasSpin ? "fa-spin" : null, animationClass);
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function mergeMeta(meta: MetaType, metaUpdate: MetaType, prefix?: string): MetaType {
    const rtn: MetaType = {};

    // Helper function to check if a key matches the prefix criteria
    const shouldIncludeKey = (key: string): boolean => {
        if (prefix === undefined) {
            return true;
        }
        if (prefix === "") {
            return !key.includes(":");
        }
        return key.startsWith(prefix + ":");
    };

    // Copy original meta (only keys matching prefix criteria)
    for (const [k, v] of Object.entries(meta)) {
        if (shouldIncludeKey(k)) {
            rtn[k] = v;
        }
    }

    // Deal with "section:*" keys (only if they match prefix criteria)
    for (const k of Object.keys(metaUpdate)) {
        if (!k.endsWith(":*")) {
            continue;
        }

        if (!metaUpdate[k]) {
            continue;
        }

        const sectionPrefix = k.slice(0, -2); // Remove ':*' suffix
        if (sectionPrefix === "") {
            continue;
        }

        // Only process if this section matches our prefix criteria
        if (!shouldIncludeKey(sectionPrefix)) {
            continue;
        }

        // Delete "[sectionPrefix]" and all keys that start with "[sectionPrefix]:"
        const prefixColon = sectionPrefix + ":";
        for (const k2 of Object.keys(rtn)) {
            if (k2 === sectionPrefix || k2.startsWith(prefixColon)) {
                delete rtn[k2];
            }
        }
    }

    // Deal with regular keys (only if they match prefix criteria)
    for (const [k, v] of Object.entries(metaUpdate)) {
        if (!shouldIncludeKey(k)) {
            continue;
        }

        if (k.endsWith(":*")) {
            continue;
        }

        if (v === null || v === undefined) {
            delete rtn[k];
            continue;
        }

        rtn[k] = v;
    }

    return rtn;
}

function escapeBytes(str: string): string {
    return str.replace(/[\s\S]/g, (ch) => {
        const code = ch.charCodeAt(0);
        switch (ch) {
            case "\n":
                return "\\n";
            case "\r":
                return "\\r";
            case "\t":
                return "\\t";
            case "\b":
                return "\\b";
            case "\f":
                return "\\f";
        }
        if (code === 0x1b) return "\\x1b"; // escape
        if (code < 0x20 || code === 0x7f) return `\\x${code.toString(16).padStart(2, "0")}`;
        return ch;
    });
}

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

type ParsedDataUrl = {
    mimeType: string;
    buffer: Uint8Array;
};

function parseDataUrl(dataUrl: string): ParsedDataUrl {
    if (!dataUrl.startsWith("data:")) throw new Error("Invalid data URL");
    const [header, data] = dataUrl.split(",", 2);
    if (data === undefined) throw new Error("Invalid data URL: missing data");

    const meta = header.slice(5);
    let mimeType = "text/plain;charset=US-ASCII";
    const parts = meta.split(";");
    if (parts[0]) mimeType = parts[0];
    const isBase64 = parts.some((p) => p.toLowerCase() === "base64");

    let buffer: Uint8Array;
    if (isBase64) {
        buffer = base64ToArray(data);
    } else {
        // assume text
        const decoded = decodeURIComponent(data);
        buffer = new TextEncoder().encode(decoded);
    }

    return { mimeType, buffer };
}

/**
 * Quotes a string for safe use in POSIX shell commands.
 * Uses single quotes and escapes embedded single quotes.
 * @param s The string to quote
 * @returns A shell-safe quoted string
 */
function shellQuote(s: string): string {
    if (s === "") {
        return "''";
    }
    // If the string contains only safe characters, return as-is
    if (/^[a-zA-Z0-9._\-/~]+$/.test(s)) {
        return s;
    }
    // Single-quote the string and escape any embedded single quotes
    // 'foo'bar' becomes 'foo'\''bar'
    return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Quotes a string for safe use in PowerShell commands.
 * Uses single quotes and escapes embedded single quotes by doubling them.
 * @param s The string to quote
 * @returns A PowerShell-safe quoted string
 */
function powershellQuote(s: string): string {
    if (s === "") {
        return "''";
    }
    // If the string contains only safe characters, return as-is
    if (/^[a-zA-Z0-9._\-/\\:~]+$/.test(s)) {
        return s;
    }
    // Single-quote the string and escape embedded single quotes by doubling them
    return "'" + s.replace(/'/g, "''") + "'";
}

/**
 * Quotes a string for safe use in Windows cmd.exe commands.
 * Uses double quotes and escapes special characters.
 * @param s The string to quote
 * @returns A cmd.exe-safe quoted string
 */
function cmdQuote(s: string): string {
    if (s === "") {
        return '""';
    }
    // If the string contains only safe characters, return as-is
    if (/^[a-zA-Z0-9._\-/\\:~]+$/.test(s)) {
        return s;
    }
    // Double-quote the string and escape embedded double quotes and special chars
    // In cmd, ^ is the escape character for special chars inside quotes
    // Double quotes inside are escaped as ""
    return '"' + s.replace(/"/g, '""') + '"';
}

const POWERSHELL_SHELLS = new Set(["pwsh", "powershell"]);
const CMD_SHELLS = new Set(["cmd"]);

/**
 * Quotes a string for safe use in shell commands based on the shell type.
 * @param s The string to quote
 * @param shellType The shell type (e.g., "bash", "zsh", "pwsh", "cmd")
 * @returns A properly quoted string for the target shell
 */
function shellQuoteForShellType(s: string, shellType: string | null | undefined): string {
    const normalizedShell = shellType?.toLowerCase() ?? "";
    if (POWERSHELL_SHELLS.has(normalizedShell)) {
        return powershellQuote(s);
    }
    if (CMD_SHELLS.has(normalizedShell)) {
        return cmdQuote(s);
    }
    return shellQuote(s);
}

function formatRelativeTime(timestamp: number): string {
    if (!timestamp) {
        return "never";
    }
    const now = Date.now();
    const diffInSeconds = Math.floor((now - timestamp) / 1000);
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    const diffInHours = Math.floor(diffInMinutes / 60);
    const diffInDays = Math.floor(diffInHours / 24);

    if (diffInMinutes <= 0) {
        return "Just now";
    } else if (diffInMinutes < 60) {
        return `${diffInMinutes} min${diffInMinutes !== 1 ? "s" : ""} ago`;
    } else if (diffInHours < 24) {
        return `${diffInHours} hr${diffInHours !== 1 ? "s" : ""} ago`;
    } else if (diffInDays < 7) {
        return `${diffInDays} day${diffInDays !== 1 ? "s" : ""} ago`;
    } else {
        return new Date(timestamp).toLocaleDateString();
    }
}

/**
 * Sort objects by display:order (ascending) and display:name (alphabetically)
 * @param a First object to compare
 * @param b Second object to compare
 * @returns Comparison result for Array.sort()
 */
function sortByDisplayOrder<T extends { "display:order"?: number; "display:name"?: string }>(a: T, b: T): number {
    const orderDiff = (a["display:order"] || 0) - (b["display:order"] || 0);
    if (orderDiff !== 0) return orderDiff;
    return (a["display:name"] || "").localeCompare(b["display:name"] || "");
}

export {
    arrayToBase64,
    atomWithDebounce,
    atomWithThrottle,
    base64ToArray,
    base64ToArrayBuffer,
    base64ToString,
    boundNumber,
    cn,
    countGraphemes,
    deepCompareReturnPrev,
    escapeBytes,
    fireAndForget,
    formatRelativeTime,
    getPrefixedSettings,
    getPromiseState,
    getPromiseValue,
    isBlank,
    isLocalConnName,
    jotaiLoadableValue,
    jsonDeepEqual,
    lazy,
    makeConnRoute,
    makeExternLink,
    makeIconClass,
    mergeMeta,
    parseDataUrl,
    powershellQuote,
    cmdQuote,
    shellQuote,
    shellQuoteForShellType,
    sleep,
    sortByDisplayOrder,
    stringToBase64,
    useAtomValueSafe,
};
