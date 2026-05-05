// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { showErrorAlert } from "@/app/modals/alertmodal";
import { ClientModel } from "@/app/store/client-model";
import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { NotesView } from "@/app/view/notes/notes";
import { WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import * as jotai from "jotai";
import type * as MonacoTypes from "monaco-editor";
import React from "react";
import { debounce } from "throttle-debounce";

type NotesEnv = WaveEnvSubset<{
    rpc: {
        GetNoteCommand: WaveEnv["rpc"]["GetNoteCommand"];
        WriteNoteCommand: WaveEnv["rpc"]["WriteNoteCommand"];
        GetRTInfoCommand: WaveEnv["rpc"]["GetRTInfoCommand"];
        SetRTInfoCommand: WaveEnv["rpc"]["SetRTInfoCommand"];
        SetConfigCommand: WaveEnv["rpc"]["SetConfigCommand"];
    };
    getSettingsKeyAtom: WaveEnv["getSettingsKeyAtom"];
}>;

type SaveStatus = "idle" | "dirty" | "saved" | "synced" | "error";

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
    filePathAtom: jotai.PrimitiveAtom<string>;
    loadErrorAtom: jotai.PrimitiveAtom<string>;
    loadedAtom: jotai.PrimitiveAtom<boolean>;
    saveStatusAtom: jotai.PrimitiveAtom<SaveStatus>;
    saveErrorAtom: jotai.PrimitiveAtom<string>;
    readOnlyAtom: jotai.PrimitiveAtom<boolean>;

    viewText!: jotai.Atom<HeaderElem[]>;
    wordWrapAtom!: jotai.Atom<boolean>;

    myOref: string;
    editorRef: React.RefObject<MonacoTypes.editor.IStandaloneCodeEditor> = { current: null };
    savedClearTimer: ReturnType<typeof setTimeout> = null;
    unsubscribeNotes: () => void = null;
    pendingContent: string = null;
    isApplyingRemoteEdit = false;

    debouncedSave = debounce(1000, (text: string) => {
        this.saveContent(text);
    });

    debouncedSaveCursorPos = debounce(500, (pos: number) => {
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
        this.myOref = WOS.makeORef("block", blockId);
        this.contentAtom = jotai.atom("");
        this.filePathAtom = jotai.atom("");
        this.loadErrorAtom = jotai.atom("");
        this.loadedAtom = jotai.atom(false);
        this.saveStatusAtom = jotai.atom<SaveStatus>("idle");
        this.saveErrorAtom = jotai.atom("");
        this.readOnlyAtom = jotai.atom(false);

        this.viewText = jotai.atom((get) => {
            const status = get(this.saveStatusAtom);
            const saveError = get(this.saveErrorAtom);
            const readOnly = get(this.readOnlyAtom);
            const spacer: HeaderElem = { elemtype: "div", className: "flex-1", children: [] };
            if (readOnly) {
                return [
                    spacer,
                    { elemtype: "text", text: "Read-only", noGrow: true, className: "opacity-50" },
                ] as HeaderElem[];
            }
            if (status === "dirty") {
                return [spacer, { elemtype: "text", text: "Editing...", noGrow: true }] as HeaderElem[];
            } else if (status === "saved") {
                return [
                    spacer,
                    { elemtype: "text", text: "Saved ✓", noGrow: true, className: "text-accent" },
                ] as HeaderElem[];
            } else if (status === "synced") {
                return [
                    spacer,
                    { elemtype: "text", text: "Synced ↓", noGrow: true, className: "text-accent" },
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

        this.wordWrapAtom = jotai.atom((get) => get(waveEnv.getSettingsKeyAtom("editor:wordwrap")) ?? false);

        this.loadFile();
        this.unsubscribeNotes = waveEventSubscribeSingle({
            eventType: "notes:updated",
            handler: (event) => this.handleNotesUpdated(event.data),
        });
    }

    get viewComponent(): ViewComponent {
        return NotesView;
    }

    setEditorRef(ref: React.RefObject<MonacoTypes.editor.IStandaloneCodeEditor>) {
        this.editorRef = ref;
    }

    clearSavedTimer() {
        if (this.savedClearTimer != null) {
            clearTimeout(this.savedClearTimer);
            this.savedClearTimer = null;
        }
    }

    setSavedTimer() {
        this.clearSavedTimer();
        this.savedClearTimer = setTimeout(() => {
            globalStore.set(this.saveStatusAtom, "idle");
            this.savedClearTimer = null;
        }, SavedDisplayMs);
    }

    onContentChange(text: string) {
        if (this.isApplyingRemoteEdit) {
            return;
        }
        this.clearSavedTimer();
        this.pendingContent = text;
        globalStore.set(this.saveStatusAtom, "dirty");
        this.debouncedSave(text);
    }

    onCursorChange(pos: number) {
        this.debouncedSaveCursorPos(pos);
    }

    onBlur() {
        if (this.pendingContent != null) {
            this.debouncedSave.cancel({ upcomingOnly: true });
            this.saveContent(this.pendingContent);
        }
    }

    async loadFile() {
        try {
            const noteData = await this.env.rpc.GetNoteCommand(TabRpcClient);
            globalStore.set(this.contentAtom, noteData?.content ?? "");
            globalStore.set(this.filePathAtom, noteData?.filepath ?? "");
            globalStore.set(this.readOnlyAtom, noteData?.readonly ?? false);
            globalStore.set(this.loadErrorAtom, "");
        } catch (err) {
            globalStore.set(this.loadErrorAtom, `Cannot load notes: ${err?.message ?? String(err)}`);
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
        this.pendingContent = null;
        console.log("[notes] saveContent start, text.len=", text.length);
        try {
            await this.env.rpc.WriteNoteCommand(TabRpcClient, {
                content: text,
                sourceoref: this.myOref,
            });
            console.log("[notes] saveContent success, setting saved");
            globalStore.set(this.saveStatusAtom, "saved");
            globalStore.set(this.saveErrorAtom, "");
            this.setSavedTimer();
        } catch (err) {
            console.log("[notes] saveContent error:", err);
            globalStore.set(this.saveStatusAtom, "error");
            globalStore.set(this.saveErrorAtom, err?.message ?? String(err));
        }
    }

    handleNotesUpdated(data: NotesUpdatedData) {
        console.log(
            "[notes] handleNotesUpdated, sourceoref=",
            data?.sourceoref,
            "myOref=",
            this.myOref,
            "currentStatus=",
            globalStore.get(this.saveStatusAtom)
        );
        if (data?.sourceoref === this.myOref) {
            console.log("[notes] handleNotesUpdated skipping (own update)");
            return;
        }
        this.debouncedSave.cancel({ upcomingOnly: true });
        this.pendingContent = null;
        const editor = this.editorRef.current;
        const content = data?.content ?? "";
        if (editor != null) {
            const editorModel = editor.getModel();
            if (editorModel != null) {
                this.isApplyingRemoteEdit = true;
                try {
                    editorModel.applyEdits([{ range: editorModel.getFullModelRange(), text: content }]);
                } finally {
                    this.isApplyingRemoteEdit = false;
                }
            }
        }
        globalStore.set(this.contentAtom, content);
        if (data?.filepath) {
            globalStore.set(this.filePathAtom, data.filepath);
        }
        if (data?.readonly != null) {
            globalStore.set(this.readOnlyAtom, data.readonly);
        }
        globalStore.set(this.saveStatusAtom, "synced");
        this.setSavedTimer();
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const wordWrap = globalStore.get(this.wordWrapAtom);
        const filePath = globalStore.get(this.filePathAtom);
        const items: ContextMenuItem[] = [];
        if (filePath) {
            items.push({
                label: "Copy Notes File Path",
                click: () => {
                    navigator.clipboard.writeText(filePath);
                },
            });
            items.push({ type: "separator" });
        }
        items.push({
            label: "Word Wrap",
            type: "checkbox",
            checked: wordWrap,
            click: () => {
                this.env.rpc.SetConfigCommand(TabRpcClient, { "editor:wordwrap": !wordWrap });
            },
        });
        return items;
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
        if (this.pendingContent != null) {
            this.saveContent(this.pendingContent);
        }
        this.debouncedSaveCursorPos.cancel();
        this.clearSavedTimer();
        if (this.unsubscribeNotes != null) {
            this.unsubscribeNotes();
        }
    }
}
