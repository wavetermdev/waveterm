import * as React from "react";
import { useCallback, useState } from "react";

// returns a callback ref, a ref object (that is set from the callback), and the width
export function useDimensionsWithCallbackRef<T extends HTMLElement>(): [
    (node: T) => void,
    React.RefObject<T>,
    DOMRectReadOnly,
] {
    const [domRect, setDomRect] = useState<DOMRectReadOnly>(null);
    const [htmlElem, setHtmlElem] = useState<T>(null);
    const rszObjRef = React.useRef<ResizeObserver>(null);
    const oldHtmlElem = React.useRef<T>(null);
    const ref = React.useRef<T>(null);
    const refCallback = useCallback((node: T) => {
        setHtmlElem(node);
        ref.current = node;
    }, []);
    React.useEffect(() => {
        if (!rszObjRef.current) {
            rszObjRef.current = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    setDomRect(entry.contentRect);
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

// will not react to ref changes
export function useDimensionsWithExistingRef<T extends HTMLElement>(ref: React.RefObject<T>): DOMRectReadOnly {
    const [domRect, setDomRect] = useState<DOMRectReadOnly>(null);
    const rszObjRef = React.useRef<ResizeObserver>(null);
    const oldHtmlElem = React.useRef<T>(null);
    React.useEffect(() => {
        if (!rszObjRef.current) {
            rszObjRef.current = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    setDomRect(entry.contentRect);
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
    }, [ref.current]);
    React.useEffect(() => {
        return () => {
            rszObjRef.current?.disconnect();
        };
    }, []);
    return domRect;
}
