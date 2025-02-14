// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// ijson values are regular JSON values: string, number, boolean, null, object, array
// path is an array of strings and numbers

type PathType = (string | number)[];

var simplePathStrRe = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function formatPath(path: PathType): string {
    if (path.length == 0) {
        return "$";
    }
    let pathStr = "$";
    for (const pathPart of path) {
        if (typeof pathPart === "string") {
            if (simplePathStrRe.test(pathPart)) {
                pathStr += "." + pathPart;
            } else {
                pathStr += "[" + JSON.stringify(pathPart) + "]";
            }
        } else if (typeof pathPart === "number") {
            pathStr += "[" + pathPart + "]";
        } else {
            pathStr += ".*";
        }
    }
    return pathStr;
}

function isArray(obj: any): boolean {
    return obj != null && Array.isArray(obj);
}

function isObject(obj: any): boolean {
    return obj != null && obj instanceof Object && !isArray(obj);
}

function getPath(obj: any, path: PathType): any {
    let cur = obj;
    for (const pathPart of path) {
        if (cur == null) {
            return null;
        }
        if (typeof pathPart === "string") {
            if (isObject(cur)) {
                cur = cur[pathPart];
            } else {
                return null;
            }
        } else if (typeof pathPart === "number") {
            if (isArray(cur)) {
                cur = cur[pathPart];
            } else {
                return null;
            }
        } else {
            throw new Error("Invalid path part: " + pathPart);
        }
    }
    return cur;
}

type SetPathOpts = {
    force?: boolean;
    remove?: boolean;
    combinefn?: (oldVal: any, newVal: any, opts: SetPathOpts) => any;
};

function combineFn_arrayAppend(oldVal: any, newVal: any, opts: SetPathOpts): any {
    if (oldVal == null) {
        return [newVal];
    }
    if (!isArray(oldVal) && !opts.force) {
        throw new Error("Cannot append to non-array: " + oldVal);
    }
    if (!isArray(oldVal)) {
        return [newVal];
    }
    oldVal.push(newVal);
    return oldVal;
}

function checkPath(path: PathType): boolean {
    if (!isArray(path)) {
        return false;
    }
    for (const pathPart of path) {
        if (typeof pathPart !== "string" && typeof pathPart !== "number") {
            return false;
        }
    }
    return true;
}

function setPath(obj: any, path: PathType, value: any, opts: SetPathOpts) {
    if (opts == null) {
        opts = {};
    }
    if (opts.remove && value != null) {
        throw new Error("Cannot set value and remove at the same time");
    }
    if (path == null) {
        path = [];
    }
    if (!checkPath(path)) {
        throw new Error("Invalid path: " + formatPath(path));
    }
    return setPathInternal(obj, path, value, opts);
}

function isEmpty(obj: any): boolean {
    if (obj == null) {
        return true;
    }
    if (isArray(obj)) {
        return obj.length == 0;
    }
    if (isObject(obj)) {
        for (const _ in obj) {
            return false;
        }
        return true;
    }
    return false;
}

function removeFromArr(arr: any[], idx: number): any[] {
    console.log("removefromarray", arr, idx);
    if (idx >= arr.length) {
        return arr;
    }
    if (idx == arr.length - 1) {
        arr.pop();
        if (arr.length == 0) {
            return null;
        }
        return arr;
    }
    arr[idx] = null;
    return arr;
}

function setPathInternal(obj: any, path: PathType, value: any, opts: SetPathOpts): any {
    if (path.length == 0) {
        if (opts.combinefn != null) {
            return opts.combinefn(obj, value, opts);
        }
        return value;
    }
    const pathPart = path[0];
    if (typeof pathPart === "string") {
        if (obj == null) {
            if (opts.remove) {
                return null;
            }
            obj = {};
        }
        if (!isObject(obj)) {
            if (opts.force) {
                obj = {};
            } else {
                throw new Error("Cannot set path on non-object: " + obj);
            }
        }
        if (opts.remove && path.length == 1) {
            delete obj[pathPart];
            if (isEmpty(obj)) {
                return null;
            }
            return obj;
        }
        const newVal = setPathInternal(obj[pathPart], path.slice(1), value, opts);
        if (opts.remove && newVal == null) {
            delete obj[pathPart];
            if (isEmpty(obj)) {
                return null;
            }
            return obj;
        }
        obj[pathPart] = newVal;
        return obj;
    } else if (typeof pathPart === "number") {
        if (pathPart < 0 || !Number.isInteger(pathPart)) {
            throw new Error("Invalid path part: " + pathPart);
        }
        if (obj == null) {
            if (opts.remove) {
                return null;
            }
            obj = [];
        }
        if (!isArray(obj)) {
            if (opts.force) {
                obj = [];
            } else {
                throw new Error("Cannot set path on non-array: " + obj);
            }
        }
        if (opts.remove && path.length == 1) {
            return removeFromArr(obj, pathPart);
        }
        const newVal = setPathInternal(obj[pathPart], path.slice(1), value, opts);
        if (opts.remove && newVal == null) {
            return removeFromArr(obj, pathPart);
        }
        obj[pathPart] = newVal;
        return obj;
    } else {
        throw new Error("Invalid path part: " + pathPart);
    }
}

function getCommandPath(command: object): PathType {
    if (command["path"] == null) {
        return [];
    }
    return command["path"];
}

function applyCommand(data: any, command: any): any {
    if (command == null) {
        throw new Error("Invalid command (null)");
    }
    if (!isObject(command)) {
        throw new Error("Invalid command (not an object): " + command);
    }
    const commandType = command.type;
    if (commandType == null) {
        throw new Error("Invalid command (no type): " + command);
    }
    const path = getCommandPath(command);
    if (!checkPath(path)) {
        throw new Error("Invalid command path: " + formatPath(path));
    }
    switch (commandType) {
        case "set":
            return setPath(data, path, command.value, null);

        case "del":
            return setPath(data, path, null, { remove: true });

        case "append":
            return setPath(data, path, command.value, { combinefn: combineFn_arrayAppend });

        default:
            throw new Error("Invalid command type: " + commandType);
    }
}

export { applyCommand, combineFn_arrayAppend, getPath, setPath };
export type { PathType, SetPathOpts };
