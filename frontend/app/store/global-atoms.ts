// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom, Atom, PrimitiveAtom } from "jotai";
import { globalStore } from "./jotaiStore";
import * as WOS from "./wos";

let atoms!: GlobalAtomsType;
const blockComponentModelMap = new Map<string, BlockComponentModel>();
const ConnStatusMapAtom = atom(new Map<string, PrimitiveAtom<ConnStatus>>());
const TabIndicatorMap = new Map<string, PrimitiveAtom<TabIndicator>>();
const orefAtomCache = new Map<string, Map<string, Atom<any>>>();

function initGlobalAtoms(initOpts: GlobalInitOptions) {
    const windowIdAtom = atom(initOpts.windowId) as PrimitiveAtom<string>;
    const builderIdAtom = atom(initOpts.builderId) as PrimitiveAtom<string>;
    const builderAppIdAtom = atom<string>(null) as PrimitiveAtom<string>;
    const waveWindowTypeAtom = atom((get) => {
        const builderId = get(builderIdAtom);
        return builderId != null ? "builder" : "tab";
    }) as Atom<"tab" | "builder">;
    const uiContextAtom = atom((get) => {
        const uiContext: UIContext = {
            windowid: initOpts.windowId,
            activetabid: initOpts.tabId,
        };
        return uiContext;
    }) as Atom<UIContext>;

    const isFullScreenAtom = atom(false) as PrimitiveAtom<boolean>;
    try {
        getApi().onFullScreenChange((isFullScreen) => {
            globalStore.set(isFullScreenAtom, isFullScreen);
        });
    } catch (e) {
        console.log("failed to initialize isFullScreenAtom", e);
    }

    const zoomFactorAtom = atom(1.0) as PrimitiveAtom<number>;
    try {
        globalStore.set(zoomFactorAtom, getApi().getZoomFactor());
        getApi().onZoomFactorChange((zoomFactor) => {
            globalStore.set(zoomFactorAtom, zoomFactor);
        });
    } catch (e) {
        console.log("failed to initialize zoomFactorAtom", e);
    }

    const workspaceAtom: Atom<Workspace> = atom((get) => {
        const windowData = WOS.getObjectValue<WaveWindow>(WOS.makeORef("window", get(windowIdAtom)), get);
        if (windowData == null) {
            return null;
        }
        return WOS.getObjectValue(WOS.makeORef("workspace", windowData.workspaceid), get);
    });
    const fullConfigAtom = atom(null) as PrimitiveAtom<FullConfigType>;
    const waveaiModeConfigAtom = atom(null) as PrimitiveAtom<Record<string, AIModeConfigType>>;
    const settingsAtom = atom((get) => {
        return get(fullConfigAtom)?.settings ?? {};
    }) as Atom<SettingsType>;
    const hasCustomAIPresetsAtom = atom((get) => {
        const fullConfig = get(fullConfigAtom);
        if (!fullConfig?.presets) {
            return false;
        }
        for (const presetId in fullConfig.presets) {
            if (presetId.startsWith("ai@") && presetId !== "ai@global" && presetId !== "ai@wave") {
                return true;
            }
        }
        return false;
    }) as Atom<boolean>;
    // this is *the* tab that this tabview represents.  it should never change.
    const staticTabIdAtom: Atom<string> = atom(initOpts.tabId);
    const controlShiftDelayAtom = atom(false);
    const updaterStatusAtom = atom<UpdaterStatus>("up-to-date") as PrimitiveAtom<UpdaterStatus>;
    try {
        globalStore.set(updaterStatusAtom, getApi().getUpdaterStatus());
        getApi().onUpdaterStatusChange((status) => {
            globalStore.set(updaterStatusAtom, status);
        });
    } catch (e) {
        console.log("failed to initialize updaterStatusAtom", e);
    }

    const reducedMotionSettingAtom = atom((get) => get(settingsAtom)?.["window:reducedmotion"]);
    const reducedMotionSystemPreferenceAtom = atom(false);

    // Composite of the prefers-reduced-motion media query and the window:reducedmotion user setting.
    const prefersReducedMotionAtom = atom((get) => {
        const reducedMotionSetting = get(reducedMotionSettingAtom);
        const reducedMotionSystemPreference = get(reducedMotionSystemPreferenceAtom);
        return reducedMotionSetting || reducedMotionSystemPreference;
    });

    // Set up a handler for changes to the prefers-reduced-motion media query.
    if (globalThis.window != null) {
        const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        globalStore.set(reducedMotionSystemPreferenceAtom, !reducedMotionQuery || reducedMotionQuery.matches);
        reducedMotionQuery?.addEventListener("change", () => {
            globalStore.set(reducedMotionSystemPreferenceAtom, reducedMotionQuery.matches);
        });
    }

    const documentHasFocusAtom = atom(true) as PrimitiveAtom<boolean>;
    if (globalThis.window != null) {
        globalStore.set(documentHasFocusAtom, document.hasFocus());
        window.addEventListener("focus", () => {
            globalStore.set(documentHasFocusAtom, true);
        });
        window.addEventListener("blur", () => {
            globalStore.set(documentHasFocusAtom, false);
        });
    }

    const modalOpen = atom(false);
    const allConnStatusAtom = atom<ConnStatus[]>((get) => {
        const connStatusMap = get(ConnStatusMapAtom);
        const connStatuses = Array.from(connStatusMap.values()).map((atom) => get(atom));
        return connStatuses;
    });
    const flashErrorsAtom = atom<FlashErrorType[]>([]);
    const notificationsAtom = atom<NotificationType[]>([]);
    const notificationPopoverModeAtom = atom<boolean>(false);
    const reinitVersion = atom(0);
    const rateLimitInfoAtom = atom(null) as PrimitiveAtom<RateLimitInfo>;
    atoms = {
        // initialized in wave.ts (will not be null inside of application)
        builderId: builderIdAtom,
        builderAppId: builderAppIdAtom,
        waveWindowType: waveWindowTypeAtom,
        uiContext: uiContextAtom,
        workspace: workspaceAtom,
        fullConfigAtom,
        waveaiModeConfigAtom,
        settingsAtom,
        hasCustomAIPresetsAtom,
        staticTabId: staticTabIdAtom,
        isFullScreen: isFullScreenAtom,
        zoomFactorAtom,
        controlShiftDelayAtom,
        updaterStatusAtom,
        prefersReducedMotionAtom,
        documentHasFocus: documentHasFocusAtom,
        modalOpen,
        allConnStatus: allConnStatusAtom,
        flashErrors: flashErrorsAtom,
        notifications: notificationsAtom,
        notificationPopoverMode: notificationPopoverModeAtom,
        reinitVersion,
        waveAIRateLimitInfoAtom: rateLimitInfoAtom,
    } as GlobalAtomsType;
}

function getAtoms(): GlobalAtomsType {
    if (atoms == null) {
        throw new Error("Global atoms accessed before initialization");
    }
    return atoms;
}

function getApi(): ElectronApi {
    return (window as any).api;
}

export { atoms, blockComponentModelMap, ConnStatusMapAtom, getAtoms, initGlobalAtoms, orefAtomCache, TabIndicatorMap };
