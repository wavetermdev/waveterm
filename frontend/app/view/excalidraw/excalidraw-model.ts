// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { base64ToString, stringToBase64 } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import {
    CaptureUpdateAction,
    convertToExcalidrawElements,
    getSceneVersion,
    serializeAsJSON,
    THEME,
} from "@excalidraw/excalidraw";
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { loadable } from "jotai/utils";

import type { WaveEnv } from "@/app/waveenv/waveenv";
import { ExcalidrawView } from "./excalidraw";

const AutosaveDebounceMs = 1500;
const MaxSaveSizeBytes = 8 * 1024 * 1024;

export class ExcalidrawModel implements ViewModel {
    viewType = "excalidraw";
    blockId: string;
    nodeModel: BlockNodeModel;
    viewComponent: ViewComponent = ExcalidrawView;

    noPadding = atom(true);
    isDirtyAtom = atom(false) as PrimitiveAtom<boolean>;

    viewIcon!: Atom<string>;
    viewName!: Atom<string>;
    themeAtom!: Atom<string>;
    filePathAtom!: Atom<string>;
    sceneAtom!: Atom<Promise<any>>;
    loadableSceneAtom!: Atom<Loadable<any>>;
    errorMsgAtom!: PrimitiveAtom<ErrorMsg>;

    blockAtom!: Atom<Block>;

    env: WaveEnv;
    excalidrawAPI: any = null;
    lastSavedVersion: number = 0;
    lastSavedBackground: string = undefined;
    lastAppliedPushId: string = null;
    lastFileUri: string = null;
    pushSeq: number = 0;
    changeSeq: number = 0;
    pendingElements: readonly any[] = [];
    pendingAppState: any = null;
    pendingFiles: any = null;
    pushSceneUnsubFn: (() => void) | null = null;
    saveTimeoutId: ReturnType<typeof setTimeout> | null = null;
    saveChain: Promise<void> = Promise.resolve();
    pendingPushScene: { elements: any[]; appState?: any; files?: any } | null = null;

    constructor({ blockId, nodeModel, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.env = waveEnv;

        this.blockAtom = waveEnv.wos.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.errorMsgAtom = atom(null) as PrimitiveAtom<ErrorMsg>;
        this.viewIcon = atom("pen-ruler");

        this.filePathAtom = atom((get) => {
            return get(this.blockAtom)?.meta?.file ?? null;
        });

        this.viewName = atom((get) => {
            const filePath = get(this.filePathAtom);
            const isDirty = get(this.isDirtyAtom);
            const name = filePath ? (filePath.split("/").pop() ?? "Excalidraw") : "Excalidraw";
            return isDirty ? `${name} *` : name;
        });

        this.themeAtom = atom(() => {
            return THEME.DARK;
        });

        this.sceneAtom = atom(async (get) => {
            const filePath = get(this.filePathAtom);
            if (!filePath) {
                return null;
            }
            const fileUri = formatRemoteUri(filePath, get(this.blockAtom)?.meta?.connection);
            this.lastFileUri = fileUri;
            try {
                const fileData = await waveEnv.rpc.FileReadCommand(TabRpcClient, {
                    info: { path: fileUri },
                });
                if (fileData?.info?.notfound) {
                    return null;
                }
                const content = base64ToString(fileData?.data64);
                if (content == null || content.trim() === "") {
                    return null;
                }
                try {
                    const scene = JSON.parse(content);
                    this.initSavedStateFromScene(scene);
                    return scene;
                } catch {
                    globalStore.set(this.errorMsgAtom, {
                        status: "Invalid Diagram File",
                        text: "The file does not contain valid Excalidraw JSON. The file may be corrupted.",
                    });
                    return null;
                }
            } catch (e) {
                globalStore.set(this.errorMsgAtom, {
                    status: "File Read Failed",
                    text: `${e}`,
                });
                return null;
            }
        });

        this.loadableSceneAtom = loadable(this.sceneAtom);

        this.pushSceneUnsubFn = waveEventSubscribeSingle({
            eventType: "excalidraw:pushscene",
            scope: `block:${blockId}`,
            handler: (event) => this.handlePushSceneEvent(event),
        });

        this.replayPersistedPush().catch((e) => console.error("excalidraw pushscene history read failed:", e));
    }

    initSavedStateFromScene(scene: any) {
        const elements = scene?.elements ?? [];
        this.lastSavedVersion = getSceneVersion(elements);
        this.lastSavedBackground = scene?.appState?.viewBackgroundColor;
        this.lastAppliedPushId = scene?.wavepushid ?? this.lastAppliedPushId;
        this.pendingElements = elements;
        this.pendingAppState = scene?.appState;
        this.pendingFiles = scene?.files;
    }

    getFileUri(): string {
        const filePath = globalStore.get(this.filePathAtom);
        if (!filePath) {
            return null;
        }
        return formatRemoteUri(filePath, globalStore.get(this.blockAtom)?.meta?.connection);
    }

    async replayPersistedPush() {
        const seq = this.pushSeq;
        const events = await this.env.rpc.EventReadHistoryCommand(TabRpcClient, {
            event: "excalidraw:pushscene",
            scope: `block:${this.blockId}`,
            maxitems: 1,
        });
        if (!events || events.length === 0) {
            return;
        }
        const event = events[events.length - 1];
        const pushData = event.data as any;
        const pushId = pushData?.pushid;
        const fileUri = this.getFileUri();
        if (fileUri && pushId) {
            try {
                const fileData = await this.env.rpc.FileReadCommand(TabRpcClient, {
                    info: { path: fileUri },
                });
                if (!fileData?.info?.notfound) {
                    const scene = JSON.parse(base64ToString(fileData?.data64));
                    if (scene?.wavepushid === pushId) {
                        this.lastAppliedPushId = pushId;
                        return;
                    }
                    if (pushData?.pushts != null && fileData?.info?.modtime > pushData.pushts) {
                        return;
                    }
                }
            } catch {}
        }
        if (this.pushSeq !== seq) {
            return;
        }
        this.handlePushSceneEvent(event);
    }

    async handlePushSceneEvent(event: WaveEvent) {
        const pushData = event.data as any;
        if (!pushData) return;
        const seq = ++this.pushSeq;

        let elements: any[];
        let appState: any = {};
        let files: any = undefined;

        if (pushData.format === "mermaid") {
            try {
                const mermaidText = pushData.scenedata as string;
                const result = await parseMermaidToExcalidraw(mermaidText);
                if (seq !== this.pushSeq) {
                    return;
                }
                elements = convertToExcalidrawElements(result.elements);
                files = result.files;
            } catch (e) {
                if (seq !== this.pushSeq) {
                    return;
                }
                globalStore.set(this.errorMsgAtom, {
                    status: "Mermaid Conversion Failed",
                    text: `${e}`,
                });
                return;
            }
        } else {
            const sceneData = pushData.scenedata ?? pushData;
            if (sceneData?.type === "excalidraw") {
                elements = sceneData.elements || [];
                appState = sceneData.appState || {};
                files = sceneData.files;
            } else if (Array.isArray(sceneData)) {
                elements = sceneData;
            } else {
                globalStore.set(this.errorMsgAtom, {
                    status: "Invalid Push Data",
                    text: 'Pushed scene must be an excalidraw scene object (with "type": "excalidraw") or an array of elements.',
                });
                return;
            }
        }

        this.lastAppliedPushId = pushData.pushid ?? null;
        const sceneUpdate = { elements, appState, files };
        if (!this.excalidrawAPI) {
            this.pendingPushScene = sceneUpdate;
            return;
        }
        this.applyRemoteScene(sceneUpdate);
    }

    setExcalidrawAPI(api: any) {
        this.excalidrawAPI = api;
        if (this.pendingPushScene && api) {
            this.applyRemoteScene(this.pendingPushScene);
            this.pendingPushScene = null;
        }
    }

    applyRemoteScene(scene: { elements: any[]; appState?: any; files?: any }) {
        if (scene.files != null && Object.keys(scene.files).length > 0) {
            this.excalidrawAPI.addFiles(Object.values(scene.files));
        }
        this.excalidrawAPI.updateScene({
            elements: scene.elements,
            appState: scene.appState,
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        this.pendingElements = scene.elements;
        this.pendingAppState = scene.appState;
        this.pendingFiles = scene.files;
        this.changeSeq++;
        globalStore.set(this.isDirtyAtom, true);
        this.debouncedSave();
    }

    handleChange(elements: readonly any[], appState: any, files: any) {
        const newVersion = getSceneVersion(elements);
        if (newVersion === this.lastSavedVersion && appState?.viewBackgroundColor === this.lastSavedBackground) {
            return;
        }
        globalStore.set(this.isDirtyAtom, true);
        this.pendingElements = elements;
        this.pendingAppState = appState;
        this.pendingFiles = files;
        this.changeSeq++;
        this.debouncedSave();
    }

    debouncedSave() {
        if (this.saveTimeoutId != null) {
            clearTimeout(this.saveTimeoutId);
        }
        this.saveTimeoutId = setTimeout(() => this.performSave(), AutosaveDebounceMs);
    }

    async performSave() {
        const fileUri = this.getFileUri() ?? this.lastFileUri;
        if (!fileUri) {
            return;
        }
        this.lastFileUri = fileUri;
        const version = getSceneVersion(this.pendingElements as any[]);
        const background = this.pendingAppState?.viewBackgroundColor;
        const seq = this.changeSeq;
        const sceneObj = JSON.parse(
            serializeAsJSON(this.pendingElements as any[], this.pendingAppState ?? {}, this.pendingFiles ?? {}, "local")
        );
        if (this.lastAppliedPushId) {
            sceneObj.wavepushid = this.lastAppliedPushId;
        }
        const data64 = stringToBase64(JSON.stringify(sceneObj, null, 2));
        if (data64.length > MaxSaveSizeBytes) {
            globalStore.set(this.errorMsgAtom, {
                status: "Diagram Too Large",
                text: "The diagram exceeds the maximum autosave size of 8MB. Remove large embedded images to keep autosave working.",
            });
            return;
        }
        this.saveChain = this.saveChain.then(async () => {
            try {
                await this.env.rpc.FileWriteCommand(TabRpcClient, {
                    info: { path: fileUri },
                    data64,
                });
                this.lastSavedVersion = version;
                this.lastSavedBackground = background;
                if (this.changeSeq === seq) {
                    globalStore.set(this.isDirtyAtom, false);
                }
            } catch (e) {
                console.error("excalidraw autosave failed:", e);
                globalStore.set(this.errorMsgAtom, {
                    status: "Autosave Failed",
                    text: `${e}`,
                });
            }
        });
        return this.saveChain;
    }

    dispose() {
        if (this.pushSceneUnsubFn) {
            this.pushSceneUnsubFn();
            this.pushSceneUnsubFn = null;
        }
        if (this.saveTimeoutId != null) {
            clearTimeout(this.saveTimeoutId);
            this.saveTimeoutId = null;
        }
        if (globalStore.get(this.isDirtyAtom)) {
            this.performSave();
        }
    }
}
