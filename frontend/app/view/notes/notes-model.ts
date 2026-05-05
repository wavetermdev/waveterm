// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { showErrorAlert } from "@/app/modals/alertmodal";
import { BlockNodeModel } from "@/app/block/blocktypes";
import { globalStore } from "@/app/store/jotaiStore";
import { ClientModel } from "@/app/store/client-model";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { NotesView } from "@/app/view/notes/notes";
import * as WOS from "@/app/store/wos";
import { WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { base64ToString, stringToBase64 } from "@/util/util";
import * as jotai from "jotai";
import { debounce } from "throttle-debounce";

type NotesEnv = WaveEnvSubset<{
    rpc: {
        FileReadCommand: WaveEnv["rpc"]["FileReadCommand"];
        FileWriteCommand: WaveEnv["rpc"]["FileWriteCommand"];
        GetRTInfoCommand: WaveEnv["rpc"]["GetRTInfoCommand"];
        SetRTInfoCommand: WaveEnv["rpc"]["SetRTInfoCommand"];
    };
}>;

type SaveStatus = "idle" | "dirty" | "saved" | "error";

const NotesFilePath = "~/notes.md";
const SavedDisplayMs = 3000;

export class NotesViewModel implements ViewModel {
    viewType = "notes";
    blockId: string;
    env: NotesEnv;
    nodeModel: BlockNodeModel;

    viewIcon = jotai.atom<string>("note-sticky");
    viewName = jotai.atom<string>("Notes");
    noPadding = jotai.atom<boolean>(true);

    contentAtom: jotai.PrimitiveAtom<string>;
    loadErrorAtom: jotai.PrimitiveAtom<string>;
    loadedAtom: jotai.PrimitiveAtom<boolean>;
    saveStatusAtom: jotai.PrimitiveAtom<SaveStatus>;
    saveErrorAtom: jotai.PrimitiveAtom<string>;

    viewText!: jotai.Atom<HeaderElem[]>;

    private editorRef: { current: any } = { current: null };
    private savedClearTimer: ReturnType<typeof setTimeout> = null;

    private debouncedSave = debounce(1000, (text: string) => {
        this.saveContent(text);
    });

    private debouncedSaveCursorPos = debounce(500, (pos: number) => {
        this.env.rpc
            .SetRTInfoCommand(TabRpcClient, {
                oref: WOS.makeORef("client", ClientModel.getInstance().clientId),
                data: { "notes:cursorpos": pos },
            })
            .catch(() => {});
    });

    constructor({ blockId, nodeModel, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.env = waveEnv as NotesEnv;
        this.contentAtom = jotai.atom("");
        this.loadErrorAtom = jotai.atom("");
        this.loadedAtom = jotai.atom(false);
        this.saveStatusAtom = jotai.atom<SaveStatus>("idle");
        this.saveErrorAtom = jotai.atom("");

        this.viewText = jotai.atom((get) => {
            const status = get(this.saveStatusAtom);
            const saveError = get(this.saveErrorAtom);
            const spacer: HeaderElem = { elemtype: "div", className: "flex-1", children: [] };
            if (status === "dirty") {
                return [spacer, { elemtype: "text", text: "Editing...", noGrow: true }] as HeaderElem[];
            } else if (status === "saved") {
                return [
                    spacer,
                    { elemtype: "text", text: "Saved ✓", noGrow: true, className: "text-accent" },
                ] as HeaderElem[];
            } else if (status === "error") {
                return [
                    spacer,
                    {
                        elemtype: "text",
                        text: "Error Saving...",
                        noGrow: true,
                        className: "text-errormsg cursor-pointer",
                        onClick: () => showErrorAlert(saveError),
                    },
                ] as HeaderElem[];
            }
            return [];
        });

        this.loadFile();
    }

    get viewComponent(): ViewComponent {
        return NotesView;
    }

    setEditorRef(ref: any) {
        this.editorRef = ref;
    }

    onContentChange(text: string) {
        if (this.savedClearTimer != null) {
            clearTimeout(this.savedClearTimer);
            this.savedClearTimer = null;
        }
        globalStore.set(this.saveStatusAtom, "dirty");
        this.debouncedSave(text);
    }

    onCursorChange(pos: number) {
        this.debouncedSaveCursorPos(pos);
    }

    async loadFile() {
        try {
            const fileData = await this.env.rpc.FileReadCommand(TabRpcClient, {
                info: { path: NotesFilePath },
            });
            const content = fileData?.data64 ? base64ToString(fileData.data64) : "";
            globalStore.set(this.contentAtom, content);
            globalStore.set(this.loadErrorAtom, "");
        } catch (err) {
            const msg: string = err?.message ?? String(err);
            if (msg.includes("no such file") || msg.includes("not found") || msg.includes("does not exist")) {
                globalStore.set(this.contentAtom, "");
                globalStore.set(this.loadErrorAtom, "");
            } else {
                globalStore.set(this.loadErrorAtom, `Cannot open ${NotesFilePath}: ${msg}`);
            }
        } finally {
            globalStore.set(this.loadedAtom, true);
        }
    }

    async restoreCursorPos() {
        const editor = this.editorRef.current;
        if (editor == null) {
            return;
        }
        try {
            const rtInfo = await this.env.rpc.GetRTInfoCommand(TabRpcClient, {
                oref: WOS.makeORef("client", ClientModel.getInstance().clientId),
            });
            const pos = rtInfo?.["notes:cursorpos"];
            if (!pos) {
                return;
            }
            const editorModel = editor.getModel();
            if (editorModel == null) {
                return;
            }
            const position = editorModel.getPositionAt(pos);
            editor.setPosition(position);
            editor.revealPosition(position);
        } catch (_e) {}
    }

    async saveContent(text: string) {
        try {
            await this.env.rpc.FileWriteCommand(TabRpcClient, {
                info: { path: NotesFilePath },
                data64: stringToBase64(text),
            });
            globalStore.set(this.saveStatusAtom, "saved");
            globalStore.set(this.saveErrorAtom, "");
            this.savedClearTimer = setTimeout(() => {
                globalStore.set(this.saveStatusAtom, "idle");
                this.savedClearTimer = null;
            }, SavedDisplayMs);
        } catch (err) {
            globalStore.set(this.saveStatusAtom, "error");
            globalStore.set(this.saveErrorAtom, err?.message ?? String(err));
        }
    }

    giveFocus(): boolean {
        if (this.editorRef.current) {
            this.editorRef.current.focus();
            return true;
        }
        return false;
    }

    dispose() {
        this.debouncedSave.cancel();
        this.debouncedSaveCursorPos.cancel();
        if (this.savedClearTimer != null) {
            clearTimeout(this.savedClearTimer);
        }
    }
}
