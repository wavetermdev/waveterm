// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { useCallback, useState } from "react";
import { debounce } from "throttle-debounce";

// returns a callback ref, a ref object (that is set from the callback), and the width
// pass debounceMs of null to not debounce
export function useDimensionsWithCallbackRef<T extends HTMLElement>(
    debounceMs: number = null
): [(node: T) => void, React.RefObject<T>, DOMRectReadOnly] {
    const [domRect, setDomRect] = useState<DOMRectReadOnly>(null);
    const [htmlElem, setHtmlElem] = useState<T>(null);
    const rszObjRef = React.useRef<ResizeObserver>(null);
    const oldHtmlElem = React.useRef<T>(null);
    const ref = React.useRef<T>(null);
    const refCallback = useCallback(
        (node: T) => {
            if (ref) {
                setHtmlElem(node);
                ref.current = node;
            }
        },
        [ref]
    );
    const setDomRectDebounced = React.useCallback(debounceMs == null ? setDomRect : debounce(debounceMs, setDomRect), [
        debounceMs,
        setDomRect,
    ]);
    React.useEffect(() => {
        if (!rszObjRef.current) {
            rszObjRef.current = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    if (domRect == null) {
                        setDomRect(entry.contentRect);
                    } else {
                        setDomRectDebounced(entry.contentRect);
                    }
                }
            });
        }
        if (htmlElem) {
            rszObjRef.current.observe(htmlElem);
            oldHtmlElem.current = htmlElem;
        }
        return () => {
            if (oldHtmlElem.current) {
                rszObjRef.current?.unobserve(oldHtmlElem.current);
                oldHtmlElem.current = null;
            }
        };
    }, [htmlElem]);
    React.useEffect(() => {
        return () => {
            rszObjRef.current?.disconnect();
        };
    }, []);
    return [refCallback, ref, domRect];
}

export function useOnResize<T extends HTMLElement>(
    ref: React.RefObject<T>,
    callback: (domRect: DOMRectReadOnly) => void,
    debounceMs: number = null
) {
    const isFirst = React.useRef(true);
    const rszObjRef = React.useRef<ResizeObserver>(null);
    const oldHtmlElem = React.useRef<T>(null);
    const setDomRectDebounced = React.useCallback(debounceMs == null ? callback : debounce(debounceMs, callback), [
        debounceMs,
        callback,
    ]);
    React.useEffect(() => {
        if (!rszObjRef.current) {
            rszObjRef.current = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    if (isFirst.current) {
                        isFirst.current = false;
                        callback(entry.contentRect);
                    } else {
                        setDomRectDebounced(entry.contentRect);
                    }
                }
            });
        }
        if (ref.current) {
            rszObjRef.current.observe(ref.current);
            oldHtmlElem.current = ref.current;
        }
        return () => {
            if (oldHtmlElem.current) {
                rszObjRef.current?.unobserve(oldHtmlElem.current);
                oldHtmlElem.current = null;
            }
        };
    }, [ref.current, callback]);
    React.useEffect(() => {
        return () => {
            rszObjRef.current?.disconnect();
        };
    }, []);
}

// will not react to ref changes
// pass debounceMs of null to not debounce
export function useDimensionsWithExistingRef<T extends HTMLElement>(
    ref?: React.RefObject<T>,
    debounceMs: number = null
): DOMRectReadOnly {
    const [domRect, setDomRect] = useState<DOMRectReadOnly>(null);
    const rszObjRef = React.useRef<ResizeObserver>(null);
    const oldHtmlElem = React.useRef<T>(null);
    const setDomRectDebounced = React.useCallback(debounceMs == null ? setDomRect : debounce(debounceMs, setDomRect), [
        debounceMs,
        setDomRect,
    ]);
    React.useEffect(() => {
        if (!rszObjRef.current) {
            rszObjRef.current = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    if (domRect == null) {
                        setDomRect(entry.contentRect);
                    } else {
                        setDomRectDebounced(entry.contentRect);
                    }
                }
            });
        }
        if (ref?.current) {
            rszObjRef.current.observe(ref.current);
            oldHtmlElem.current = ref.current;
        }
        return () => {
            if (oldHtmlElem.current) {
                rszObjRef.current?.unobserve(oldHtmlElem.current);
                oldHtmlElem.current = null;
            }
        };
    }, [ref?.current]);
    React.useEffect(() => {
        return () => {
            rszObjRef.current?.disconnect();
        };
    }, []);
    if (ref?.current != null) {
        return ref.current.getBoundingClientRect();
    }
    return null;
}
