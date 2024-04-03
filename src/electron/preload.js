let { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
    hideWindow: () => ipc.Renderer.send("hide-window"),
    toggleDeveloperTools: () => ipcRenderer.send("toggle-developer-tools"),
    getId: () => ipcRenderer.sendSync("get-id"),
    getPlatform: () => ipcRenderer.sendSync("get-platform"),
    getIsDev: () => ipcRenderer.sendSync("get-isdev"),
    getAuthKey: () => ipcRenderer.sendSync("get-authkey"),
    getWaveSrvStatus: () => ipcRenderer.sendSync("wavesrv-status"),
    getLastLogs: (numberOfLines, callback) => {
        ipcRenderer.send("get-last-logs", numberOfLines);
        ipcRenderer.once("last-logs", (event, data) => callback(data));
    },
    getInitialTermFontFamily: () => ipcRenderer.sendSync("get-initial-termfontfamily"),
    getShouldUseDarkColors: () => ipcRenderer.sendSync("get-shouldusedarkcolors"),
    getNativeThemeSource: () => ipcRenderer.sendSync("get-nativethemesource"),
    setNativeThemeSource: (source) => ipcRenderer.send("set-nativethemesource", source),
    onNativeThemeUpdated: (callback) => ipcRenderer.on("nativetheme-updated", callback),
    restartWaveSrv: () => ipcRenderer.sendSync("restart-server"),
    reloadWindow: () => ipcRenderer.sendSync("reload-window"),
    reregisterGlobalShortcut: (shortcut) => ipcRenderer.sendSync("reregister-global-shortcut", shortcut),
    openExternalLink: (url) => ipcRenderer.send("open-external-link", url),
    changeAutoUpdate: (enabled) => ipcRenderer.send("change-auto-update", enabled),
    installAppUpdate: () => ipcRenderer.send("install-app-update"),
    getAppUpdateStatus: () => ipcRenderer.sendSync("get-app-update-status"),
    onAppUpdateStatus: (callback) => ipcRenderer.on("app-update-status", (_, val) => callback(val)),
    onZoomChanged: (callback) => ipcRenderer.on("zoom-changed", callback),
    onMenuItemAbout: (callback) => ipcRenderer.on("menu-item-about", callback),
    contextScreen: (screenOpts, position) => ipcRenderer.send("context-screen", screenOpts, position),
    contextEditMenu: (position, opts) => ipcRenderer.send("context-editmenu", position, opts),
    onWaveSrvStatusChange: (callback) => ipcRenderer.on("wavesrv-status-change", callback),
    onToggleDevUI: (callback) => ipcRenderer.on("toggle-devui", callback),
    pathBaseName: (path) => ipcRenderer.sendSync("path-basename", path),
    pathSep: () => ipcRenderer.sendSync("path-sep"),
});
