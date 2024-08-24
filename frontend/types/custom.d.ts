// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type * as jotai from "jotai";
import type * as rxjs from "rxjs";

declare global {
    type GlobalAtomsType = {
        windowId: jotai.Atom<string>; // readonly
        clientId: jotai.Atom<string>; // readonly
        client: jotai.Atom<Client>; // driven from WOS
        uiContext: jotai.Atom<UIContext>; // driven from windowId, activetabid, etc.
        waveWindow: jotai.Atom<WaveWindow>; // driven from WOS
        workspace: jotai.Atom<Workspace>; // driven from WOS
        settingsConfigAtom: jotai.PrimitiveAtom<SettingsConfigType>; // driven from WOS, settings -- updated via WebSocket
        tabAtom: jotai.Atom<Tab>; // driven from WOS
        activeTabId: jotai.Atom<string>; // derrived from windowDataAtom
        isFullScreen: jotai.PrimitiveAtom<boolean>;
        controlShiftDelayAtom: jotai.PrimitiveAtom<boolean>;
        reducedMotionPreferenceAtom: jotai.Atom<boolean>;
        updaterStatusAtom: jotai.PrimitiveAtom<UpdaterStatus>;
        typeAheadModalAtom: jotai.Primitive<TypeAheadModalType>;
    };

    type WritableWaveObjectAtom<T extends WaveObj> = jotai.WritableAtom<T, [value: T], void>;

    type ThrottledValueAtom<T> = jotai.WritableAtom<T, [update: jotai.SetStateAction<T>], void>;

    type AtomWithThrottle<T> = {
        currentValueAtom: jotai.Atom<T>;
        throttledValueAtom: ThrottledValueAtom<T>;
    };

    type DebouncedValueAtom<T> = jotai.WritableAtom<T, [update: jotai.SetStateAction<T>], void>;

    type AtomWithDebounce<T> = {
        currentValueAtom: jotai.Atom<T>;
        debouncedValueAtom: DebouncedValueAtom<T>;
    };

    type SplitAtom<Item> = Atom<Atom<Item>[]>;
    type WritableSplitAtom<Item> = WritableAtom<PrimitiveAtom<Item>[], [SplitAtomAction<Item>], void>;

    type TabLayoutData = {
        blockId: string;
    };

    type ElectronApi = {
        getAuthKey(): string;
        getIsDev(): boolean;
        getCursorPoint: () => Electron.Point;

        getPlatform: () => NodeJS.Platform;
        getEnv: (varName: string) => string;

        showContextMenu: (menu?: ElectronContextMenuItem[]) => void;
        onContextMenuClick: (callback: (id: string) => void) => void;
        onNavigate: (callback: (url: string) => void) => void;
        onIframeNavigate: (callback: (url: string) => void) => void;
        downloadFile: (path: string) => void;
        openExternal: (url: string) => void;
        onFullScreenChange: (callback: (isFullScreen: boolean) => void) => void;
        onUpdaterStatusChange: (callback: (status: UpdaterStatus) => void) => void;
        getUpdaterStatus: () => UpdaterStatus;
        installAppUpdate: () => void;
        onMenuItemAbout: (callback: () => void) => void;
        updateWindowControlsOverlay: (rect: Dimensions) => void;
    };

    type ElectronContextMenuItem = {
        id: string; // unique id, used for communication
        label: string;
        role?: string; // electron role (optional)
        type?: "separator" | "normal" | "submenu";
        submenu?: ElectronContextMenuItem[];
    };

    type ContextMenuItem = {
        label?: string;
        type?: "separator" | "normal" | "submenu";
        role?: string; // electron role (optional)
        click?: () => void; // not required if role is set
        submenu?: ContextMenuItem[];
    };

    type KeyPressDecl = {
        mods: {
            Cmd?: boolean;
            Option?: boolean;
            Shift?: boolean;
            Ctrl?: boolean;
            Alt?: boolean;
            Meta?: boolean;
        };
        key: string;
        keyType: string;
    };

    interface WaveKeyboardEvent {
        type: string;
        /**
         * Equivalent to KeyboardEvent.key.
         */
        key: string;
        /**
         * Equivalent to KeyboardEvent.code.
         */
        code: string;
        /**
         * Equivalent to KeyboardEvent.shiftKey.
         */
        shift: boolean;
        /**
         * Equivalent to KeyboardEvent.controlKey.
         */
        control: boolean;
        /**
         * Equivalent to KeyboardEvent.altKey.
         */
        alt: boolean;
        /**
         * Equivalent to KeyboardEvent.metaKey.
         */
        meta: boolean;
        /**
         * cmd is special, on mac it is meta, on windows it is alt
         */
        cmd: boolean;
        /**
         * option is special, on mac it is alt, on windows it is meta
         */
        option: boolean;

        repeat: boolean;
        /**
         * Equivalent to KeyboardEvent.location.
         */
        location: number;
    }

    type SubjectWithRef<T> = rxjs.Subject<T> & { refCount: number; release: () => void };

    type HeaderElem = HeaderIconButton | HeaderText | HeaderInput | HeaderDiv | HeaderTextButton | ConnectionButton;

    type HeaderIconButton = {
        elemtype: "iconbutton";
        icon: string | React.ReactNode;
        className?: string;
        title?: string;
        click?: (e: React.MouseEvent<any>) => void;
        longClick?: (e: React.MouseEvent<any>) => void;
    };

    type HeaderTextButton = {
        elemtype: "textbutton";
        text: string;
        className?: string;
        onClick?: (e: React.MouseEvent<any>) => void;
    };

    type HeaderText = {
        elemtype: "text";
        text: string;
    };

    type HeaderInput = {
        elemtype: "input";
        value: string;
        className?: string;
        isDisabled?: boolean;
        ref?: React.MutableRefObject<HTMLInputElement>;
        onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
        onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
        onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
        onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
    };

    type HeaderDiv = {
        elemtype: "div";
        className?: string;
        children: HeaderElem[];
        onMouseOver?: (e: React.MouseEvent<any>) => void;
        onMouseOut?: (e: React.MouseEvent<any>) => void;
        onClick?: (e: React.MouseEvent<any>) => void;
    };

    type ConnectionButton = {
        elemtype: "connectionbutton";
        icon: string;
        text: string;
        iconColor: string;
        onClick?: (e: React.MouseEvent<any>) => void;
        connected: boolean;
    };

    interface ViewModel {
        viewType: string;
        viewIcon?: jotai.Atom<string | HeaderIconButton>;
        viewName?: jotai.Atom<string>;
        viewText?: jotai.Atom<string | HeaderElem[]>;
        preIconButton?: jotai.Atom<HeaderIconButton>;
        endIconButtons?: jotai.Atom<HeaderIconButton[]>;
        blockBg?: jotai.Atom<MetaType>;

        onBack?: () => void;
        onForward?: () => void;
        onSearchChange?: (text: string) => void;
        onSearch?: (text: string) => void;
        getSettingsMenuItems?: () => ContextMenuItem[];
        giveFocus?: () => boolean;
        keyDownHandler?: (e: WaveKeyboardEvent) => boolean;
    }

    type UpdaterStatus = "up-to-date" | "checking" | "downloading" | "ready" | "error" | "installing";

    // jotai doesn't export this type :/
    type Loadable<T> = { state: "loading" } | { state: "hasData"; data: T } | { state: "hasError"; error: unknown };

    interface Dimensions {
        width: number;
        height: number;
        left: number;
        top: number;
    }

    type TypeAheadModalType = { [key: string]: boolean };
}

export {};
