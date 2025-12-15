import BrowserOnly from "@docusaurus/BrowserOnly";
import { useContext } from "react";
import "./kbd.css";
import type { Platform } from "./platformcontext";
import { PlatformContext } from "./platformcontext";

function convertKey(platform: Platform, key: string): [any, string, boolean] {
    if (key == "Arrows") {
        return [<span className="spaced">↑→↓←</span>, "Arrow Keys", true];
    }
    if (key == "ArrowUp") {
        return ["↑", "Arrow Up", true];
    }
    if (key == "ArrowRight") {
        return ["→", "Arrow Right", true];
    }
    if (key == "ArrowDown") {
        return ["↓", "Arrow Down", true];
    }
    if (key == "ArrowLeft") {
        return ["←", "Arrow Left", true];
    }
    if (key == "Cmd") {
        if (platform === "mac") {
            return ["⌘", "Command", true];
        } else {
            return ["Alt", "Alt", false];
        }
    }
    if (key == "Ctrl") {
        if (platform === "mac") {
            return ["⌃", "Control", true];
        } else {
            return ["Ctrl", "Control", false];
        }
    }
    if (key == "Shift") {
        return ["⇧", "Shift", true];
    }
    if (key == "Escape") {
        return ["Esc", "Escape", false];
    }
    return [key.length > 1 ? key : key.toUpperCase(), key, false];
}

// Custom KBD component
const KbdInternal = ({ k, windows, mac, linux }: { k: string; windows?: string; mac?: string; linux?: string }) => {
    const { platform } = useContext(PlatformContext);
    
    // Determine which key binding to use based on platform overrides
    let keyBinding = k;
    if (platform === "windows" && windows) {
        keyBinding = windows;
    } else if (platform === "mac" && mac) {
        keyBinding = mac;
    } else if (platform === "linux" && linux) {
        keyBinding = linux;
    }
    
    const keys = keyBinding.split(":");
    const keyElems = keys.map((key, i) => {
        const [displayKey, title, symbol] = convertKey(platform, key);
        return (
            <kbd key={i} title={title} aria-label={title} className={symbol ? "symbol" : null}>
                {displayKey}
            </kbd>
        );
    });
    return <div className="kbd-group">{keyElems}</div>;
};

export const Kbd = ({ k, windows, mac, linux }: { k: string; windows?: string; mac?: string; linux?: string }) => {
    return <BrowserOnly fallback={<kbd>{k}</kbd>}>{() => <KbdInternal k={k} windows={windows} mac={mac} linux={linux} />}</BrowserOnly>;
};

export const KbdChord = ({ karr }: { karr: string[] }) => {
    const elems: React.ReactNode[] = [];
    for (let i = 0; i < karr.length; i++) {
        if (i > 0) {
            elems.push(<span style={{ padding: "0 2px" }}>+</span>);
        }
        elems.push(<Kbd key={i} k={karr[i]} />);
    }
    const fullElem = <span style={{ whiteSpace: "nowrap" }}>{elems}</span>;
    return <BrowserOnly fallback={null}>{() => fullElem}</BrowserOnly>;
};
