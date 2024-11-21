import BrowserOnly from "@docusaurus/BrowserOnly";
import { createContext, ReactNode, useCallback, useContext, useState } from "react";
import { UAParser } from "ua-parser-js";

import clsx from "clsx";
import "./platformcontext.css";

export type Platform = "mac" | "linux" | "windows";

interface PlatformContextProps {
    platform: Platform;
    setPlatform: (platform: Platform) => void;
}

export const PlatformContext = createContext<PlatformContextProps | undefined>(undefined);

const detectPlatform = (): Platform => {
    const savedPlatform = localStorage.getItem("platform") as Platform | null;
    if (savedPlatform) {
        return savedPlatform;
    }
    const { os } = UAParser(navigator.userAgent);

    if (/Windows/.test(os.name)) {
        return "windows";
    } else if (/Mac OS|iOS/.test(os.name)) {
        return "mac";
    } else {
        return "linux";
    }
};

const PlatformProviderInternal = ({ children }: { children: ReactNode }) => {
    const [platform, setPlatform] = useState<Platform>(detectPlatform());

    const setPlatformCallback = useCallback((newPlatform: Platform) => {
        setPlatform(newPlatform);
        localStorage.setItem("platform", newPlatform); // Store in localStorage
    }, []);

    return (
        <PlatformContext.Provider value={{ platform, setPlatform: setPlatformCallback }}>
            {children}
        </PlatformContext.Provider>
    );
};

export const PlatformProvider: React.FC = ({ children }: { children: ReactNode }) => {
    return (
        <BrowserOnly fallback={<div />}>
            {() => <PlatformProviderInternal>{children}</PlatformProviderInternal>}
        </BrowserOnly>
    );
};

export const usePlatform = (): PlatformContextProps => {
    const context = useContext(PlatformContext);
    if (!context) {
        throw new Error("usePlatform must be used within a PlatformProvider");
    }
    return context;
};

const PlatformSelectorButtonInternal: React.FC = () => {
    const { platform, setPlatform } = usePlatform();

    return (
        <div className="pill-toggle">
            <button className={clsx("pill-option", { active: platform === "mac" })} onClick={() => setPlatform("mac")}>
                macOS
            </button>
            <button
                className={clsx("pill-option", { active: platform === "linux" })}
                onClick={() => setPlatform("linux")}
            >
                Linux
            </button>
            <button
                className={clsx("pill-option", { active: platform === "windows" })}
                onClick={() => setPlatform("windows")}
            >
                Windows
            </button>
        </div>
    );
};

export const PlatformSelectorButton: React.FC = () => {
    return <BrowserOnly fallback={<div />}>{() => <PlatformSelectorButtonInternal />}</BrowserOnly>;
};

interface PlatformItemProps {
    children: ReactNode;
    platforms: Platform[];
}

const PlatformItemInternal = ({ children, platforms }: PlatformItemProps) => {
    const platform = usePlatform();

    return platforms.includes(platform.platform) && children;
};

export const PlatformItem = (props: PlatformItemProps) => {
    return <BrowserOnly fallback={<div />}>{() => <PlatformItemInternal {...props} />}</BrowserOnly>;
};
