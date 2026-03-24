// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

type Props = {
    value?: string;
    onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    onInput?: (e: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    ttlMs?: number; // default 100
    ref?: React.Ref<HTMLInputElement | HTMLTextAreaElement>;
    _tagName: "input" | "textarea";
} & Omit<React.InputHTMLAttributes<HTMLInputElement> & React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onInput">;

/**
 * OptimisticInput - A React input component that provides optimistic UI updates for Tsunami's framework.
 *
 * Problem: In Tsunami's reactive framework, every onChange event is sent to the server, which can cause
 * the cursor to jump or typing to feel laggy as the server responds with updates.
 *
 * Solution: This component applies updates optimistically by maintaining a "shadow" value that shows
 * immediately in the UI while waiting for server acknowledgment. If the server responds with the same
 * value within the TTL period (default 100ms), the optimistic update is confirmed. If the server
 * doesn't respond or responds with a different value, the input reverts to the server value.
 *
 * Key behaviors:
 * - For controlled inputs (value provided): Uses optimistic updates with shadow state
 * - For uncontrolled inputs (value undefined): Behaves like a normal React input
 * - Skips optimistic logic when disabled or readonly
 * - Handles IME composition properly to avoid interfering with multi-byte character input
 * - Supports both onChange and onInput event handlers
 * - Preserves cursor position through React's natural behavior (no manual cursor management)
 *
 * Example usage:
 * ```tsx
 * <OptimisticInput
 *   value={serverValue}
 *   onChange={(e) => sendToServer(e.target.value)}
 *   ttlMs={200}
 * />
 * ```
 */
function OptimisticInput({ value, onChange, onInput, ttlMs = 100, ref: forwardedRef, _tagName, ...rest }: Props) {
    const [shadow, setShadow] = React.useState<string | null>(null);
    const timer = React.useRef<number | undefined>(undefined);

    const startTTL = React.useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
            // no ack within TTL → revert to server
            setShadow(null);
            // caret will follow serverValue; optionally restore selRef here if you track a server caret
        }, ttlMs);
    }, [ttlMs]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        // Skip validation during IME composition
        // (works in modern browsers/React via nativeEvent)
        // @ts-expect-error React typing doesn't surface this directly
        if (e.nativeEvent?.isComposing) return;

        // If uncontrolled (value is undefined), skip optimistic logic
        if (value === undefined) {
            onChange?.(e);
            onInput?.(e);
            return;
        }

        // Skip optimistic logic if readonly or disabled
        if (rest.disabled || rest.readOnly) {
            onChange?.(e);
            onInput?.(e);
            return;
        }

        const v = e.currentTarget.value;
        setShadow(v); // optimistic echo
        startTTL(); // wait for ack
        onChange?.(e);
        onInput?.(e);
    };

    // Ack: backend caught up → drop shadow (and stop the TTL)
    React.useLayoutEffect(() => {
        if (shadow !== null && shadow === value) {
            setShadow(null);
            if (timer.current) clearTimeout(timer.current);
        }
    }, [value, shadow]);

    React.useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current);
        },
        []
    );

    const realValue = value === undefined ? undefined : (shadow ?? value ?? "");
    
    if (_tagName === "textarea") {
        return <textarea ref={forwardedRef as React.Ref<HTMLTextAreaElement>} value={realValue} onChange={handleChange} {...rest} />;
    }
    
    return <input ref={forwardedRef as React.Ref<HTMLInputElement>} value={realValue} onChange={handleChange} {...rest} />;
}

export default OptimisticInput;
