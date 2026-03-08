import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import * as React from "react";

import { base64ToArray } from "@/util/base64";

export type TsunamiTermElem = HTMLDivElement & {
    __termWrite: (data64: string) => void;
    __termFocus: () => void;
    __termSize: () => VDomTermSize | null;
};

type TsunamiTermProps = React.HTMLAttributes<HTMLDivElement> & {
    onData?: (data: string | null, termsize: VDomTermSize | null) => void;
    termFontSize?: number;
    termFontFamily?: string;
    termScrollback?: number;
};

const TsunamiTerm = React.forwardRef<HTMLDivElement, TsunamiTermProps>(function TsunamiTerm(props, ref) {
    const { onData, termFontSize, termFontFamily, termScrollback, ...outerProps } = props;
    const outerRef = React.useRef<TsunamiTermElem>(null);
    const termRef = React.useRef<HTMLDivElement>(null);
    const terminalRef = React.useRef<Terminal | null>(null);
    const onDataRef = React.useRef(onData);
    onDataRef.current = onData;

    const setOuterRef = React.useCallback(
        (elem: TsunamiTermElem) => {
            outerRef.current = elem;
            if (elem != null) {
                elem.__termWrite = (data64: string) => {
                    if (data64 == null || data64 === "") {
                        return;
                    }
                    try {
                        terminalRef.current?.write(base64ToArray(data64));
                    } catch (error) {
                        console.error("Failed to write to terminal:", error);
                    }
                };
                elem.__termFocus = () => {
                    terminalRef.current?.focus();
                };
                elem.__termSize = () => {
                    const terminal = terminalRef.current;
                    if (terminal == null) {
                        return null;
                    }
                    return { rows: terminal.rows, cols: terminal.cols };
                };
            }
            if (typeof ref === "function") {
                ref(elem);
                return;
            }
            if (ref != null) {
                ref.current = elem;
            }
        },
        [ref]
    );

    React.useEffect(() => {
        if (termRef.current == null) {
            return;
        }
        const terminal = new Terminal({
            convertEol: false,
            ...(termFontSize != null ? { fontSize: termFontSize } : {}),
            ...(termFontFamily != null ? { fontFamily: termFontFamily } : {}),
            ...(termScrollback != null ? { scrollback: termScrollback } : {}),
        });
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(termRef.current);
        fitAddon.fit();
        terminalRef.current = terminal;

        const onDataDisposable = terminal.onData((data) => {
            if (onDataRef.current == null) {
                return;
            }
            onDataRef.current(data, null);
        });
        const onResizeDisposable = terminal.onResize((size) => {
            if (onDataRef.current == null) {
                return;
            }
            onDataRef.current(null, { rows: size.rows, cols: size.cols });
        });
        if (onDataRef.current != null) {
            onDataRef.current(null, { rows: terminal.rows, cols: terminal.cols });
        }

        const resizeObserver = new ResizeObserver(() => {
            fitAddon.fit();
        });
        if (outerRef.current != null) {
            resizeObserver.observe(outerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
            onResizeDisposable.dispose();
            onDataDisposable.dispose();
            terminal.dispose();
            terminalRef.current = null;
        };
    }, []);

    React.useEffect(() => {
        const terminal = terminalRef.current;
        if (terminal == null) {
            return;
        }
        if (termFontSize != null) {
            terminal.options.fontSize = termFontSize;
        }
        if (termFontFamily != null) {
            terminal.options.fontFamily = termFontFamily;
        }
        if (termScrollback != null) {
            terminal.options.scrollback = termScrollback;
        }
    }, [termFontSize, termFontFamily, termScrollback]);

    const handleFocus = React.useCallback(
        (e: React.FocusEvent<HTMLDivElement>) => {
            terminalRef.current?.focus();
            outerProps.onFocus?.(e);
        },
        [outerProps.onFocus]
    );

    const handleBlur = React.useCallback(
        (e: React.FocusEvent<HTMLDivElement>) => {
            terminalRef.current?.blur();
            outerProps.onBlur?.(e);
        },
        [outerProps.onBlur]
    );

    return (
        <div
            {...outerProps}
            ref={setOuterRef as React.RefCallback<HTMLDivElement>}
            onFocus={handleFocus}
            onBlur={handleBlur}
        >
            <div ref={termRef} className="w-full h-full" />
        </div>
    );
});

export { TsunamiTerm };
