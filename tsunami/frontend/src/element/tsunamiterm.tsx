import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import * as React from "react";

import { base64ToArray, stringToBase64 } from "@/util/base64";

const TermWriteEventName = "tsunami:termwrite";

type TermSize = {
    rows: number;
    cols: number;
};

type TermInputPayload = {
    id: string;
    termsize?: TermSize;
    data64?: string;
};

type TermWritePayload = {
    id: string;
    data64: string;
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
    const outerRef = React.useRef<HTMLDivElement>(null);
    const termRef = React.useRef<HTMLDivElement>(null);
    const terminalRef = React.useRef<Terminal | null>(null);

    const setOuterRef = React.useCallback(
        (elem: HTMLDivElement) => {
            outerRef.current = elem;
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

    React.useEffect(() => {
        const handleTermWrite = (event: Event) => {
            const detail = (event as CustomEvent<TermWritePayload>).detail;
            if (detail == null || detail.id !== id || detail.data64 == null || detail.data64 === "") {
                return;
            }
            try {
                terminalRef.current?.write(base64ToArray(detail.data64));
            } catch (error) {
                console.error("Failed to process term write event:", error);
            }
        };
        window.addEventListener(TermWriteEventName, handleTermWrite);
        return () => {
            window.removeEventListener(TermWriteEventName, handleTermWrite);
        };
    }, [id]);

    return (
        <div {...outerProps} id={id} ref={setOuterRef}>
            <div ref={termRef} className="w-full h-full" />
        </div>
    );
});

export { TermWriteEventName, TsunamiTerm };
