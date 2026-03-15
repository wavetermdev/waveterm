// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { WaveEnvContext } from "@/app/waveenv/waveenv";
import { makeMockWaveEnv } from "@/preview/mock/mockwaveenv";
import { stringToBase64 } from "@/util/util";
import { atom } from "jotai";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { type ConfigFile, WaveConfigViewModel } from "./waveconfig-model";
import { WaveConfigView } from "./waveconfig";

vi.mock("@/app/view/codeeditor/codeeditor", () => ({
    CodeEditor: () => null,
}));

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("waveconfig waveenv integration", () => {
    it("uses the supplied env for model initialization and config file selection", async () => {
        const blockId = "waveconfig-env-block";
        const env = makeMockWaveEnv({
            platform: "win32",
            electron: {
                getConfigDir: () => "/mock/config",
            },
            rpc: {
                FileInfoCommand: async () => ({ notfound: true }),
                FileReadCommand: async (_client, payload) => ({
                    data64: stringToBase64(`{"path":"${payload.info.path}"}`),
                }),
            },
            mockWaveObjs: {
                [`block:${blockId}`]: {
                    otype: "block",
                    oid: blockId,
                    version: 1,
                    meta: {},
                } as Block,
            },
        });
        const model = new WaveConfigViewModel({
            blockId,
            nodeModel: {
                isFocused: atom(false),
                focusNode: () => {},
            } as any,
            tabModel: {} as any,
            waveEnv: env,
        });

        await flushPromises();
        await flushPromises();

        expect(model.configDir).toBe("/mock/config");
        expect(model.saveShortcut).toBe("Alt+S");
        expect(model.getConfigFiles().find((file) => file.path === "connections.json")?.description).toBe(
            "SSH hosts and WSL distros"
        );
        expect(globalStore.get(model.selectedFileAtom)?.path).toBe("settings.json");
        expect(globalStore.get(model.fileContentAtom)).toContain("/mock/config/settings.json");
        expect(globalStore.get(env.wos.getWaveObjectAtom<Block>(`block:${blockId}`))?.meta?.file).toBe("settings.json");
    });

    it("renders config errors from the supplied env atom", () => {
        const env = makeMockWaveEnv({
            atoms: {
                fullConfigAtom: atom({
                    configerrors: [{ file: "settings.json", err: "env config error" }],
                } as FullConfigType),
            },
        });

        const selectedFile: ConfigFile = {
            name: "Secrets",
            path: "secrets",
            hasJsonView: false,
            visualComponent: () => <div>secrets content</div>,
        };
        const model = {
            selectedFileAtom: atom(selectedFile),
            fileContentAtom: atom(""),
            isLoadingAtom: atom(false),
            isSavingAtom: atom(false),
            errorMessageAtom: atom(null) as any,
            validationErrorAtom: atom(null) as any,
            isMenuOpenAtom: atom(false),
            hasEditedAtom: atom(false),
            activeTabAtom: atom<"visual" | "json">("visual"),
            configErrorFilesAtom: atom(new Set<string>()),
            nodeModel: {
                isFocused: atom(false),
            },
            editorRef: { current: null },
            saveShortcut: "Cmd+S",
            getConfigFiles: () => [selectedFile],
            getDeprecatedConfigFiles: () => [],
            markAsEdited: () => {},
            saveFile: () => {},
            clearError: () => {},
            clearValidationError: () => {},
        } as WaveConfigViewModel;

        const markup = renderToStaticMarkup(
            <WaveEnvContext.Provider value={env}>
                <WaveConfigView blockId="waveconfig-view-block" model={model} />
            </WaveEnvContext.Provider>
        );

        expect(markup).toContain("Config Error:");
        expect(markup).toContain("settings.json: env config error");
    });
});
