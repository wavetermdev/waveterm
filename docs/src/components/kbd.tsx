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
        return ["⌃", "Control", true];
    }
    if (key == "Shift") {
        return ["⇧", "Shift", true];
    }
    if (key == "Escape") {
        return ["Esc", null, false];
    }
    return [key, null, false];
}

// Custom KBD component
const KbdInternal = ({ k }: { k: string }) => {
    const { platform } = useContext(PlatformContext);
    const keys = k.split(":");
    const keyElems = keys.map((key, i) => {
        const [displayKey, title, symbol] = convertKey(platform, key);
        return (
            <kbd key={i} title={title} className={symbol ? "symbol" : null}>
                {displayKey}
            </kbd>
        );
    });
    return <div className="kbd-group">{keyElems}</div>;
};

export const Kbd = ({ k }: { k: string }) => {
    return <BrowserOnly fallback={<kbd>{k}</kbd>}>{() => <KbdInternal k={k} />}</BrowserOnly>;
};
