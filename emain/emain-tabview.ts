export class WaveTabView extends Electron.WebContentsView {
    isActiveTab: boolean;
    waveWindowId: string; // set when showing in an active window
    waveTabId: string; // always set, WaveTabViews are unique per tab
    lastUsedTs: number; // ts milliseconds
    createdTs: number; // ts milliseconds
    initPromise: Promise<void>;
    savedInitOpts: WaveInitOpts;
    waveReadyPromise: Promise<void>;
    initResolve: () => void;
    waveReadyResolve: () => void;
}
