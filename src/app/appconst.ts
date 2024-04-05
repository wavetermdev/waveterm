export const ABOUT = "about";
export const CREATE_REMOTE = "createRemote";
export const VIEW_REMOTE = "viewRemote";
export const EDIT_REMOTE = "editRemote";
export const ALERT = "alert";
export const SCREEN_SETTINGS = "screenSettings";
export const SESSION_SETTINGS = "sessionSettings";
export const LINE_SETTINGS = "lineSettings";
export const CLIENT_SETTINGS = "clientSettings";
export const TAB_SWITCHER = "tabSwitcher";
export const USER_INPUT = "userInput";

export const LineContainer_Main = "main";
export const LineContainer_History = "history";
export const LineContainer_Sidebar = "sidebar";

export const ConfirmKey_HideShellPrompt = "hideshellprompt";

export const NoStrPos = -1;

export const RemotePtyRows = 8;
export const RemotePtyTotalRows = 25;
export const RemotePtyCols = 80;
export const ProdServerEndpoint = "http://127.0.0.1:1619";
export const ProdServerWsEndpoint = "ws://127.0.0.1:1623";
export const DevServerEndpoint = "http://127.0.0.1:8090";
export const DevServerWsEndpoint = "ws://127.0.0.1:8091";
export const DefaultTermFontSize = 13;
export const DefaultTermFontFamily = "Hack";
export const DefaultTheme = "dark";
export const MinFontSize = 8;
export const MaxFontSize = 24;
export const InputChunkSize = 500;
export const RemoteColors = ["red", "green", "yellow", "blue", "magenta", "cyan", "white", "orange"];
export const TabColors = ["red", "orange", "yellow", "green", "mint", "cyan", "blue", "violet", "pink", "white"];
export const TabIcons = [
    "square",
    "sparkle",
    "fire",
    "ghost",
    "cloud",
    "compass",
    "crown",
    "droplet",
    "graduation-cap",
    "heart",
    "file",
];

// @ts-ignore
export const VERSION = __WAVETERM_VERSION__;
// @ts-ignore
export const BUILD = __WAVETERM_BUILD__;

/**
 * Levels for the screen status indicator
 */
export enum StatusIndicatorLevel {
    None = 0,
    Output = 1,
    Success = 2,
    Error = 3,
}

// matches packet.go
export const ErrorCode_InvalidCwd = "ERRCWD";

export const AuxView_History = "history";
export const AuxView_Info = "info";
export const AuxView_AIChat = "aichat";
