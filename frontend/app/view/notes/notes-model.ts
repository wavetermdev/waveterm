// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { NotesView } from "@/app/view/notes/notes";
import { WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { base64ToString, stringToBase64 } from "@/util/util";
import * as jotai from "jotai";

type NotesEnv = WaveEnvSubset<{
    rpc: {
        FileReadCommand: WaveEnv["rpc"]["FileReadCommand"];
        FileWriteCommand: WaveEnv["rpc"]["FileWriteCommand"];
    };
}>;

const NotesFilePath = "~/notes.md";

export class NotesViewModel implements ViewModel {
    viewType = "notes";
    blockId: string;
    env: NotesEnv;

    viewIcon = jotai.atom<string>("note-sticky");
    viewName = jotai.atom<string>("Notes");
    noPadding = jotai.atom<boolean>(true);

    contentAtom: jotai.PrimitiveAtom<string>;
    errorAtom: jotai.PrimitiveAtom<string>;
    loadedAtom: jotai.PrimitiveAtom<boolean>;

    private editorRef: { current: any } = { current: null };

    constructor({ blockId, waveEnv }: ViewModelInitType) {
        this.blockId = blockId;
        this.env = waveEnv as NotesEnv;
        this.contentAtom = jotai.atom("");
        this.errorAtom = jotai.atom("");
        this.loadedAtom = jotai.atom(false);
        this.loadFile();
    }

    get viewComponent(): ViewComponent {
        return NotesView;
    }

    setEditorRef(ref: any) {
        this.editorRef = ref;
    }

    async loadFile() {
        try {
            const fileData = await this.env.rpc.FileReadCommand(TabRpcClient, {
                info: { path: NotesFilePath },
            });
            const content = fileData?.data64 ? base64ToString(fileData.data64) : "";
            globalStore.set(this.contentAtom, content);
            globalStore.set(this.errorAtom, "");
        } catch (err) {
            const msg: string = err?.message ?? String(err);
            if (msg.includes("no such file") || msg.includes("not found") || msg.includes("does not exist")) {
                globalStore.set(this.contentAtom, "");
                globalStore.set(this.errorAtom, "");
            } else {
                globalStore.set(this.errorAtom, `Cannot open ${NotesFilePath}: ${msg}`);
            }
        } finally {
            globalStore.set(this.loadedAtom, true);
        }
    }

    async saveContent(text: string) {
        try {
            await this.env.rpc.FileWriteCommand(TabRpcClient, {
                info: { path: NotesFilePath },
                data64: stringToBase64(text),
            });
        } catch (err) {
            globalStore.set(this.errorAtom, `Cannot save ${NotesFilePath}: ${err?.message ?? String(err)}`);
        }
    }

    giveFocus(): boolean {
        if (this.editorRef.current) {
            this.editorRef.current.focus();
            return true;
        }
        return false;
    }
}
