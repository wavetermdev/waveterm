// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { type Placement } from "@floating-ui/react";
import type * as jotai from "jotai";
import type * as rxjs from "rxjs";

declare global {
    type GlobalAtomsType = {
        clientId: jotai.Atom<string>; // readonly
        builderId: jotai.PrimitiveAtom<string>; // readonly (for builder mode)
        builderAppId: jotai.PrimitiveAtom<string>; // app being edited in builder mode
        waveWindowType: jotai.Atom<"tab" | "builder">; // derived from builderId
        client: jotai.Atom<Client>; // driven from WOS
        uiContext: jotai.Atom<UIContext>; // driven from windowId, tabId
        waveWindow: jotai.Atom<WaveWindow>; // driven from WOS
        workspace: jotai.Atom<Workspace>; // driven from WOS
        fullConfigAtom: jotai.PrimitiveAtom<FullConfigType>; // driven from WOS, settings -- updated via WebSocket
        waveaiModeConfigAtom: jotai.PrimitiveAtom<Record<string, AIModeConfigType>>; // resolved AI mode configs -- updated via WebSocket
        settingsAtom: jotai.Atom<SettingsType>; // derrived from fullConfig
        hasCustomAIPresetsAtom: jotai.Atom<boolean>; // derived from fullConfig
        tabAtom: jotai.Atom<Tab>; // driven from WOS
        staticTabId: jotai.Atom<string>;
        isFullScreen: jotai.PrimitiveAtom<boolean>;
        zoomFactorAtom: jotai.PrimitiveAtom<number>;
        controlShiftDelayAtom: jotai.PrimitiveAtom<boolean>;
        prefersReducedMotionAtom: jotai.Atom<boolean>;
        updaterStatusAtom: jotai.PrimitiveAtom<UpdaterStatus>;
        typeAheadModalAtom: jotai.PrimitiveAtom<TypeAheadModalType>;
        modalOpen: jotai.PrimitiveAtom<boolean>;
        allConnStatus: jotai.Atom<ConnStatus[]>;
        flashErrors: jotai.PrimitiveAtom<FlashErrorType[]>;
        notifications: jotai.PrimitiveAtom<NotificationType[]>;
        notificationPopoverMode: jotai.Atom<boolean>;
        reinitVersion: jotai.PrimitiveAtom<number>;
        isTermMultiInput: jotai.PrimitiveAtom<boolean>;
        waveAIRateLimitInfoAtom: jotai.PrimitiveAtom<RateLimitInfo>;
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

    type WaveInitOpts = {
        tabId: string;
        clientId: string;
        windowId: string;
        activate: boolean;
        primaryTabStartup?: boolean;
    };

    type BuilderInitOpts = {
        builderId: string;
        clientId: string;
        windowId: string;
    };

    type ElectronApi = {
        getAuthKey(): string; // get-auth-key
        getIsDev(): boolean; // get-is-dev
        getCursorPoint: () => Electron.Point; // get-cursor-point
        getPlatform: () => NodeJS.Platform; // get-platform
        getEnv: (varName: string) => string; // get-env
        getUserName: () => string; // get-user-name
        getHostName: () => string; // get-host-name
        getDataDir: () => string; // get-data-dir
        getConfigDir: () => string; // get-config-dir
        getHomeDir: () => string; // get-home-dir
        getWebviewPreload: () => string; // get-webview-preload
        getAboutModalDetails: () => AboutModalDetails; // get-about-modal-details
        getZoomFactor: () => number; // get-zoom-factor
        showWorkspaceAppMenu: (workspaceId: string) => void; // workspace-appmenu-show
        showBuilderAppMenu: (builderId: string) => void; // builder-appmenu-show
        showContextMenu: (workspaceId: string, menu: ElectronContextMenuItem[]) => void; // contextmenu-show
        onContextMenuClick: (callback: (id: string) => void) => void; // contextmenu-click
        onNavigate: (callback: (url: string) => void) => void;
        onIframeNavigate: (callback: (url: string) => void) => void;
        downloadFile: (path: string) => void; // download
        openExternal: (url: string) => void; // open-external
        onFullScreenChange: (callback: (isFullScreen: boolean) => void) => void; // fullscreen-change
        onZoomFactorChange: (callback: (zoomFactor: number) => void) => void; // zoom-factor-change
        onUpdaterStatusChange: (callback: (status: UpdaterStatus) => void) => void; // app-update-status
        getUpdaterStatus: () => UpdaterStatus; // get-app-update-status
        getUpdaterChannel: () => string; // get-updater-channel
        installAppUpdate: () => void; // install-app-update
        onMenuItemAbout: (callback: () => void) => void; // menu-item-about
        updateWindowControlsOverlay: (rect: Dimensions) => void; // update-window-controls-overlay
        onReinjectKey: (callback: (waveEvent: WaveKeyboardEvent) => void) => void; // reinject-key
        setWebviewFocus: (focusedId: number) => void; // webview-focus, focusedId is the getWebContentsId of the webview
        registerGlobalWebviewKeys: (keys: string[]) => void; // register-global-webview-keys
        onControlShiftStateUpdate: (callback: (state: boolean) => void) => void; // control-shift-state-update
        createWorkspace: () => void; // create-workspace
        switchWorkspace: (workspaceId: string) => void; // switch-workspace
        deleteWorkspace: (workspaceId: string) => void; // delete-workspace
        setActiveTab: (tabId: string) => void; // set-active-tab
        createTab: () => void; // create-tab
        closeTab: (workspaceId: string, tabId: string) => void; // close-tab
        setWindowInitStatus: (status: "ready" | "wave-ready") => void; // set-window-init-status
        onWaveInit: (callback: (initOpts: WaveInitOpts) => void) => void; // wave-init
        onBuilderInit: (callback: (initOpts: BuilderInitOpts) => void) => void; // builder-init
        sendLog: (log: string) => void; // fe-log
        onQuicklook: (filePath: string) => void; // quicklook
        openNativePath(filePath: string): void; // open-native-path
        captureScreenshot(rect: Electron.Rectangle): Promise<string>; // capture-screenshot
        setKeyboardChordMode: () => void; // set-keyboard-chord-mode
        clearWebviewStorage: (webContentsId: number) => Promise<void>; // clear-webview-storage
        setWaveAIOpen: (isOpen: boolean) => void; // set-waveai-open
        closeBuilderWindow: () => void; // close-builder-window
        incrementTermCommands: () => void; // increment-term-commands
        nativePaste: () => void; // native-paste
        openBuilder: (appId?: string) => void; // open-builder
        setBuilderWindowAppId: (appId: string) => void; // set-builder-window-appid
        doRefresh: () => void; // do-refresh
    };

    type ElectronContextMenuItem = {
        id: string; // unique id, used for communication
        label: string;
        role?: string; // electron role (optional)
        type?: "separator" | "normal" | "submenu" | "checkbox" | "radio" | "header";
        submenu?: ElectronContextMenuItem[];
        checked?: boolean;
        visible?: boolean;
        enabled?: boolean;
        sublabel?: string;
    };

    type ContextMenuItem = {
        label?: string;
        type?: "separator" | "normal" | "submenu" | "checkbox" | "radio" | "header";
        role?: string; // electron role (optional)
        click?: () => void; // not required if role is set
        submenu?: ContextMenuItem[];
        checked?: boolean;
        visible?: boolean;
        enabled?: boolean;
        sublabel?: string;
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

    type SubjectWithRef<T> = rxjs.Subject<T> & { refCount: number; release: () => void };

    type HeaderElem =
        | IconButtonDecl
        | ToggleIconButtonDecl
        | HeaderText
        | HeaderInput
        | HeaderDiv
        | HeaderTextButton
        | ConnectionButton
        | MenuButton;

    type IconButtonCommon = {
        icon: string | React.ReactNode;
        iconColor?: string;
        iconSpin?: boolean;
        className?: string;
        title?: string;
        disabled?: boolean;
        noAction?: boolean;
    };

    type IconButtonDecl = IconButtonCommon & {
        elemtype: "iconbutton";
        click?: (e: React.MouseEvent<any>) => void;
        longClick?: (e: React.MouseEvent<any>) => void;
    };

    type ToggleIconButtonDecl = IconButtonCommon & {
        elemtype: "toggleiconbutton";
        active: jotai.WritableAtom<boolean, [boolean], void>;
    };

    type HeaderTextButton = {
        elemtype: "textbutton";
        text: string;
        className?: string;
        title?: string;
        onClick?: (e: React.MouseEvent<any>) => void;
    };

    type HeaderText = {
        elemtype: "text";
        text: string;
        ref?: React.RefObject<HTMLDivElement>;
        className?: string;
        noGrow?: boolean;
        onClick?: (e: React.MouseEvent<any>) => void;
    };

    type HeaderInput = {
        elemtype: "input";
        value: string;
        className?: string;
        isDisabled?: boolean;
        ref?: React.RefObject<HTMLInputElement>;
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

    type MenuItem = {
        label: string;
        icon?: string | React.ReactNode;
        subItems?: MenuItem[];
        onClick?: (e: React.MouseEvent<any>) => void;
    };

    type MenuButtonProps = {
        items: MenuItem[];
        className?: string;
        text: string;
        title?: string;
        menuPlacement?: Placement;
    };

    type MenuButton = {
        elemtype: "menubutton";
    } & MenuButtonProps;

    type SearchAtoms = {
        searchValue: PrimitiveAtom<string>;
        resultsIndex: PrimitiveAtom<number>;
        resultsCount: PrimitiveAtom<number>;
        isOpen: PrimitiveAtom<boolean>;
        regex?: PrimitiveAtom<boolean>;
        caseSensitive?: PrimitiveAtom<boolean>;
        wholeWord?: PrimitiveAtom<boolean>;
    };

    declare type ViewComponentProps<T extends ViewModel> = {
        blockId: string;
        blockRef: React.RefObject<HTMLDivElement>;
        contentRef: React.RefObject<HTMLDivElement>;
        model: T;
    };

    declare type ViewComponent = React.FC<ViewComponentProps>;

    type ViewModelClass = new (blockId: string, nodeModel: BlockNodeModel) => ViewModel;

    interface ViewModel {
        // The type of view, used for identifying and rendering the appropriate component.
        viewType: string;

        // Icon representing the view, can be a string or an IconButton declaration.
        viewIcon?: jotai.Atom<string | IconButtonDecl>;

        // Optional color for the view icon.
        viewIconColor?: jotai.Atom<string>;

        // Display name for the view, used in UI headers.
        viewName?: jotai.Atom<string>;

        // Optional header text or elements for the view.
        viewText?: jotai.Atom<string | HeaderElem[]>;

        // Icon button displayed before the title in the header.
        preIconButton?: jotai.Atom<IconButtonDecl>;

        // Icon buttons displayed at the end of the block header.
        endIconButtons?: jotai.Atom<IconButtonDecl[]>;

        // Background styling metadata for the block.
        blockBg?: jotai.Atom<MetaType>;

        noHeader?: jotai.Atom<boolean>;

        // Whether the block manages its own connection (e.g., for remote access).
        manageConnection?: jotai.Atom<boolean>;

        // If true, filters out 'nowsh' connections (when managing connections)
        filterOutNowsh?: jotai.Atom<boolean>;

        // if true, show s3 connections in picker
        showS3?: jotai.Atom<boolean>;

        // If true, removes padding inside the block content area.
        noPadding?: jotai.Atom<boolean>;

        // Atoms used for managing search functionality within the block.
        searchAtoms?: SearchAtoms;

        // The main view component associated with this ViewModel.
        viewComponent: ViewComponent<ViewModel>;

        // Function to determine if this is a basic terminal block.
        isBasicTerm?: (getFn: jotai.Getter) => boolean;

        // Returns menu items for the settings dropdown.
        getSettingsMenuItems?: () => ContextMenuItem[];

        // Attempts to give focus to the block, returning true if successful.
        giveFocus?: () => boolean;

        // Handles keydown events within the block.
        keyDownHandler?: (e: WaveKeyboardEvent) => boolean;

        // Cleans up resources when the block is disposed.
        dispose?: () => void;
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

    interface AboutModalDetails {
        version: string;
        buildTime: number;
    }

    type BlockComponentModel = {
        openSwitchConnection?: () => void;
        viewModel: ViewModel;
    };

    type ConnStatusType = "connected" | "connecting" | "disconnected" | "error" | "init";

    interface SuggestionBaseItem {
        label: string;
        value: string;
        icon?: string | React.ReactNode;
    }

    interface SuggestionConnectionItem extends SuggestionBaseItem {
        status: ConnStatusType;
        iconColor: string;
        onSelect?: (_: string) => void;
        current?: boolean;
    }

    interface SuggestionConnectionScope {
        headerText?: string;
        items: SuggestionConnectionItem[];
    }

    type SuggestionsType = SuggestionConnectionItem | SuggestionConnectionScope;

    type MarkdownResolveOpts = {
        connName: string;
        baseDir: string;
    };

    type FlashErrorType = {
        id: string;
        icon: string;
        title: string;
        message: string;
        expiration: number;
    };

    export type NotificationActionType = {
        label: string;
        actionKey: string;
        rightIcon?: string;
        color?: "green" | "grey";
        disabled?: boolean;
    };

    export type NotificationType = {
        id?: string;
        icon: string;
        title: string;
        message: string;
        timestamp: string;
        expiration?: number;
        hidden?: boolean;
        actions?: NotificationActionType[];
        persistent?: boolean;
        type?: "error" | "update" | "info" | "warning";
    };

    interface AbstractWshClient {
        recvRpcMessage(msg: RpcMessage): void;
    }

    type ClientRpcEntry = {
        reqId: string;
        startTs: number;
        command: string;
        msgFn: (msg: RpcMessage) => void;
    };

    type TimeSeriesMeta = {
        name?: string;
        color?: string;
        label?: string;
        maxy?: string | number;
        miny?: string | number;
        decimalPlaces?: number;
    };

    interface SuggestionRequestContext {
        widgetid: string;
        reqnum: number;
        dispose?: boolean;
    }

    type SuggestionsFnType = (query: string, reqContext: SuggestionRequestContext) => Promise<FetchSuggestionsResponse>;

    type DraggedFile = {
        uri: string;
        absParent: string;
        relName: string;
        isDir: boolean;
    };

    type ErrorButtonDef = {
        text: string;
        onClick: () => void;
    };

    type ErrorMsg = {
        status: string;
        text: string;
        level?: "error" | "warning";
        buttons?: Array<ErrorButtonDef>;
        closeAction?: () => void;
        showDismiss?: boolean;
    };

    type AIMessage = {
        messageid: string;
        parts: AIMessagePart[];
    };

    type AIMessagePart =
        | {
              type: "text";
              text: string;
          }
        | {
              type: "file";
              mimetype: string; // required
              filename?: string;
              data?: string; // base64 encoded data
              url?: string;
              size?: number;
              previewurl?: string;
          };

    type AIModeConfigWithMode = { mode: string } & AIModeConfigType;
}

export {};
