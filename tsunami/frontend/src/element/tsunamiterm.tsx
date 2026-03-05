import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import * as React from "react";

import { base64ToArray, stringToBase64 } from "@/util/base64";

type TermSize = {
    rows: number;
    cols: number;
};

type TermInputPayload = {
    id: string;
    termsize?: TermSize;
    data64?: string;
};

export type TsunamiTermElem = HTMLDivElement & {
    __termWrite: (data64: string) => void;
    __termFocus: () => void;
};

async function sendTermInput(payload: TermInputPayload) {
    const response = await fetch("/api/terminput", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`terminal input request failed: ${response.status} ${response.statusText}`);
    }
}

const TsunamiTerm = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function TsunamiTerm(
    props,
    ref
) {
    const { id, ...outerProps } = props;
    const outerRef = React.useRef<TsunamiTermElem>(null);
    const termRef = React.useRef<HTMLDivElement>(null);
    const terminalRef = React.useRef<Terminal | null>(null);

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
        });
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(termRef.current);
        fitAddon.fit();
        terminalRef.current = terminal;

        const onDataDisposable = terminal.onData((data) => {
            if (id == null || id === "") {
                return;
            }
            sendTermInput({
                id,
                data64: stringToBase64(data),
            }).catch((error) => {
                console.error("Failed to send terminal input:", error);
            });
        });
        const onResizeDisposable = terminal.onResize((size) => {
            if (id == null || id === "") {
                return;
            }
            sendTermInput({
                id,
                termsize: {
                    rows: size.rows,
                    cols: size.cols,
                },
            }).catch((error) => {
                console.error("Failed to send terminal resize:", error);
            });
        });

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
    }, [id]);

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
        <div {...outerProps} id={id} ref={setOuterRef as React.RefCallback<HTMLDivElement>} onFocus={handleFocus} onBlur={handleBlur}>
            <div ref={termRef} className="w-full h-full" />
        </div>
    );
});

export { TsunamiTerm };
