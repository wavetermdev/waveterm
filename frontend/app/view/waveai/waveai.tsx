// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Markdown } from "@/app/element/markdown";
import { TypingIndicator } from "@/app/element/typingindicator";
import { RpcResponseHelper, WshClient } from "@/app/store/wshclient";
import { RpcApi } from "@/app/store/wshclientapi";
import { makeFeBlockRouteId } from "@/app/store/wshrouter";
import { DefaultRouter, TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms, createBlock, fetchWaveFile, getApi, globalStore, WOS } from "@/store/global";
import { BlockService, ObjectService } from "@/store/services";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import { fireAndForget, isBlank, makeIconClass, mergeMeta, stringToBase64 } from "@/util/util";
import { atom, Atom, PrimitiveAtom, useAtomValue, WritableAtom } from "jotai";
import { splitAtom } from "jotai/utils";
import type { OverlayScrollbars } from "overlayscrollbars";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { debounce, throttle } from "throttle-debounce";
import "./waveai.scss";
// Import directly with relative paths
import AutonomousModeToggle from "./autonomousmodetoggle";
import { FileAttachmentButton, FileAttachmentList } from "./fileattachment";
import { FilePicker } from "./filepicker";

// Debug function to test command execution from the console
// Usage: window.testWaveAICommand("echo hello")
(window as any).testWaveAICommand = async (command: string) => {
    console.log("Test command execution:", command);

    try {
        // Get current tab from user using prompt
        const tabId = prompt("Enter tab ID (leave empty to create in current tab)");

        if (!tabId) {
            console.error("No tab ID provided");
            return;
        }

        console.log("Using tab ID:", tabId);

        // Create a new terminal block with the command
        const result = await RpcApi.CreateBlockCommand(TabRpcClient, {
            tabid: tabId,
            blockdef: {
                meta: {
                    view: "term",
                    controller: "cmd",
                    cmd: command,
                    "cmd:runonstart": true,
                    "cmd:clearonstart": true,
                    "cmd:shell": true,
                },
            },
        });

        console.log("Created new terminal block:", result);
    } catch (err) {
        console.error("Error in test command:", err);
    }
};

// Debug function to check block state and parent tab
// Usage: window.debugBlockState('block-id-here')
(window as any).debugBlockState = (blockId: string) => {
    try {
        const blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        const blockState = globalStore.get(blockAtom);
        console.log("Block state:", blockState);

        const tabId = blockState?.meta?.["parent"];
        console.log("Tab ID from block:", tabId);

        return { blockState, tabId };
    } catch (err) {
        console.error("Error in debug block state:", err);
        return null;
    }
};

// Debug function to directly test the terminal execution from console
// Usage: window.debugExecuteInTerminal("echo hello")
(window as any).debugExecuteInTerminal = (command: string) => {
    console.log("%c Debug: Execute In Terminal:", "background: #ff0; color: #000", command);

    // Get workspace info
    try {
        const workspace = globalStore.get(atoms.workspace);
        console.log("%c Debug: Workspace:", "background: #ff0; color: #000", workspace);
    } catch (err) {
        console.error("Error getting workspace info:", err);
    }

    // Get all WaveAI blocks from the DOM
    const blocks = document.querySelectorAll('[data-view="waveai"]');
    console.log("%c Debug: Found WaveAI blocks:", "background: #ff0; color: #000", blocks);

    if (blocks.length === 0) {
        console.error("No WaveAI blocks found in DOM");
        alert("No WaveAI blocks found");
        return;
    }

    // Get the blockId from the first WaveAI block
    const blockId = blocks[0].getAttribute("data-blockid");
    console.log("%c Debug: Using blockId:", "background: #ff0; color: #000", blockId);

    if (!blockId) {
        console.error("Could not get blockId from WaveAI component");
        alert("Could not get blockId");
        return;
    }

    // Create a WaveAiModel instance
    const model = new WaveAiModel(blockId);
    console.log("%c Debug: Created WaveAiModel instance:", "background: #ff0; color: #000", model);

    // Execute the command
    console.log("%c Debug: Attempting to execute command:", "background: #ff0; color: #000", command);
    model.executeInTerminal(command);
};

// Debug function to find valid tab IDs
// Usage: window.findTabIds()
(window as any).findTabIds = () => {
    console.log("%c ===== Finding Tab IDs ====", "background: #f00; color: #fff");

    try {
        // Try to get the static tab ID from atoms
        const staticTabId = globalStore.get(atoms.staticTabId);
        console.log("%c Static Tab ID:", "background: #f00; color: #fff", staticTabId);

        // Try to get all the tabs from the workspace
        const workspace = globalStore.get(atoms.workspace);
        console.log("%c Workspace:", "background: #f00; color: #fff", workspace);

        // Look for any tab-related properties
        if (workspace) {
            // Print all the keys in the workspace
            console.log("%c Workspace Keys:", "background: #f00; color: #fff", Object.keys(workspace));

            // Print all properties one by one for inspection
            for (const key in workspace) {
                console.log(`%c Workspace["${key}"] =`, "background: #f00; color: #fff", workspace[key]);
            }
        }

        // Try to find blocks in the DOM
        const blocks = document.querySelectorAll("[data-blockid]");
        console.log("%c All Blocks in DOM:", "background: #f00; color: #fff", blocks);

        // Extract the block IDs
        const blockIds = Array.from(blocks).map((block) => {
            return {
                blockId: block.getAttribute("data-blockid"),
                view: block.getAttribute("data-view"),
            };
        });
        console.log("%c Block IDs in DOM:", "background: #f00; color: #fff", blockIds);

        // Get tab IDs from HTML elements that might have them
        const tabElements = document.querySelectorAll("[data-tabid]");
        console.log("%c Tab Elements:", "background: #f00; color: #fff", tabElements);
        const tabIds = Array.from(tabElements).map((el) => el.getAttribute("data-tabid"));
        console.log("%c Tab IDs from DOM:", "background: #f00; color: #fff", tabIds);

        return {
            staticTabId,
            workspace,
            blockIds,
            tabIds,
        };
    } catch (err) {
        console.error("Error finding tab IDs:", err);
        return null;
    }
};

// Debug function to execute a command with an explicit tab ID
// Usage: window.executeWithTabId("tab:1234", "echo hello")
(window as any).executeWithTabId = async (tabId: string, command: string) => {
    console.log("%c Executing command with explicit tab ID:", "background: #f0f; color: #fff", { tabId, command });

    try {
        if (!TabRpcClient) {
            console.error("TabRpcClient is not available");
            alert("TabRpcClient is not available");
            return;
        }

        // Create a new terminal block that executes the command
        const blockId = await RpcApi.CreateBlockCommand(TabRpcClient, {
            tabid: tabId,
            blockdef: {
                meta: {
                    view: "term",
                    controller: "cmd",
                    cmd: command,
                    "cmd:runonstart": true,
                    "cmd:clearonstart": true,
                    "cmd:shell": true,
                },
            },
        });

        console.log("%c Created new terminal block:", "background: #f0f; color: #fff", blockId);
        return blockId;
    } catch (err) {
        console.error("Error creating terminal block:", err);
        alert(`Error: ${err.message}`);
        return null;
    }
};

// Debug function to test getting tab info and blocks
// Usage: window.debugGetTabInfo("tab:1234")
(window as any).debugGetTabInfo = async (tabId: string) => {
    console.log("%c Getting tab info for:", "background: #0ff; color: #000", tabId);

    try {
        if (!TabRpcClient) {
            console.error("TabRpcClient is not available");
            return null;
        }

        // Get tab info
        const tabInfo = await RpcApi.GetTabCommand(TabRpcClient, tabId);
        console.log("%c Tab info:", "background: #0ff; color: #000", tabInfo);

        // Extract block IDs from the tab
        const blockIds = tabInfo?.blockids || [];
        console.log("%c Block IDs in tab:", "background: #0ff; color: #000", blockIds);

        // Get info for each block
        const blocks = [];
        for (const blockId of blockIds) {
            try {
                const blockInfo = await RpcApi.BlockInfoCommand(TabRpcClient, blockId);
                blocks.push({
                    id: blockId,
                    meta: blockInfo?.block?.meta,
                    isTerminal: blockInfo?.block?.meta?.view === "term",
                });
            } catch (err) {
                console.error(`Error getting info for block ${blockId}:`, err);
                blocks.push({ id: blockId, error: err.message });
            }
        }

        console.log("%c Blocks in tab:", "background: #0ff; color: #000", blocks);

        // Get terminal blocks
        const terminalBlocks = blocks.filter((b) => b.isTerminal);
        console.log("%c Terminal blocks:", "background: #0ff; color: #000", terminalBlocks);

        return { tabInfo, blocks, terminalBlocks };
    } catch (err) {
        console.error("Error getting tab info:", err);
        return null;
    }
};

interface ChatMessageType {
    id: string;
    user: string;
    text: string;
    isUpdating?: boolean;
}

const outline = "2px solid var(--accent-color)";
const slidingWindowSize = 30;

interface ChatItemProps {
    chatItemAtom: Atom<ChatMessageType>;
    model: WaveAiModel;
}

function promptToMsg(prompt: WaveAIPromptMessageType): ChatMessageType {
    return {
        id: crypto.randomUUID(),
        user: prompt.role,
        text: prompt.content,
    };
}

class AiWshClient extends WshClient {
    blockId: string;
    model: WaveAiModel;

    constructor(blockId: string, model: WaveAiModel) {
        super(makeFeBlockRouteId(blockId));
        this.blockId = blockId;
        this.model = model;
    }

    handle_aisendmessage(rh: RpcResponseHelper, data: AiMessageData) {
        if (isBlank(data.message)) {
            return;
        }
        this.model.sendMessage(data.message);
    }
}

export class WaveAiModel implements ViewModel {
    viewType: string;
    blockId: string;
    blockAtom: Atom<Block>;
    presetKey: Atom<string>;
    presetMap: Atom<{ [k: string]: MetaType }>;
    mergedPresets: Atom<MetaType>;
    aiOpts: Atom<WaveAIOptsType>;
    viewIcon?: Atom<string | IconButtonDecl>;
    viewName?: Atom<string>;
    viewText?: Atom<string | HeaderElem[]>;
    preIconButton?: Atom<IconButtonDecl>;
    endIconButtons?: Atom<IconButtonDecl[]>;
    messagesAtom: PrimitiveAtom<Array<ChatMessageType>>;
    messagesSplitAtom: SplitAtom<Array<ChatMessageType>>;
    latestMessageAtom: Atom<ChatMessageType>;
    addMessageAtom: WritableAtom<unknown, [message: ChatMessageType], void>;
    updateLastMessageAtom: WritableAtom<unknown, [text: string, isUpdating: boolean], void>;
    removeLastMessageAtom: WritableAtom<unknown, [], void>;
    simulateAssistantResponseAtom: WritableAtom<unknown, [userMessage: ChatMessageType], Promise<void>>;
    textAreaRef: React.RefObject<HTMLTextAreaElement>;
    locked: PrimitiveAtom<boolean>;
    cancel: boolean;
    aiWshClient: AiWshClient;
    fileAttachmentsAtom: PrimitiveAtom<FileAttachment[]>;
    addFileAttachmentAtom: WritableAtom<unknown, [attachment: FileAttachment], void>;
    removeFileAttachmentAtom: WritableAtom<unknown, [filePath: string], void>;
    clearFileAttachmentsAtom: WritableAtom<unknown, [], void>;

    constructor(blockId: string) {
        this.aiWshClient = new AiWshClient(blockId, this);
        DefaultRouter.registerRoute(makeFeBlockRouteId(blockId), this.aiWshClient);
        this.locked = atom(false);
        this.cancel = false;
        this.viewType = "waveai";
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = atom("sparkles");
        this.viewName = atom("Wave AI");
        this.messagesAtom = atom([]);
        this.messagesSplitAtom = splitAtom(this.messagesAtom);
        this.latestMessageAtom = atom((get) => get(this.messagesAtom).slice(-1)[0]);

        // File attachment atoms
        this.fileAttachmentsAtom = atom<FileAttachment[]>([]);

        // Add file attachment
        this.addFileAttachmentAtom = atom(null, (get, set, attachment: FileAttachment) => {
            const attachments = get(this.fileAttachmentsAtom);
            set(this.fileAttachmentsAtom, [...attachments, attachment]);
        });

        // Remove file attachment
        this.removeFileAttachmentAtom = atom(null, (get, set, filePath: string) => {
            const attachments = get(this.fileAttachmentsAtom);
            set(
                this.fileAttachmentsAtom,
                attachments.filter((a) => a.file_path !== filePath)
            );
        });

        // Clear all file attachments
        this.clearFileAttachmentsAtom = atom(null, (_, set) => {
            set(this.fileAttachmentsAtom, []);
        });
        this.presetKey = atom((get) => {
            const metaPresetKey = get(this.blockAtom).meta["ai:preset"];
            const globalPresetKey = get(atoms.settingsAtom)["ai:preset"];
            return metaPresetKey ?? globalPresetKey;
        });
        this.presetMap = atom((get) => {
            const fullConfig = get(atoms.fullConfigAtom);
            const presets = fullConfig.presets;
            const settings = fullConfig.settings;
            return Object.fromEntries(
                Object.entries(presets)
                    .filter(([k]) => k.startsWith("ai@"))
                    .map(([k, v]) => {
                        const aiPresetKeys = Object.keys(v).filter((k) => k.startsWith("ai:"));
                        const newV = { ...v };
                        newV["display:name"] =
                            aiPresetKeys.length == 1 && aiPresetKeys.includes("ai:*")
                                ? `${newV["display:name"] ?? "Default"} (${settings["ai:model"]})`
                                : newV["display:name"];
                        return [k, newV];
                    })
            );
        });

        this.addMessageAtom = atom(null, (get, set, message: ChatMessageType) => {
            const messages = get(this.messagesAtom);
            set(this.messagesAtom, [...messages, message]);
        });

        this.updateLastMessageAtom = atom(null, (get, set, text: string, isUpdating: boolean) => {
            const messages = get(this.messagesAtom);
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.user == "assistant") {
                const updatedMessage = { ...lastMessage, text: lastMessage.text + text, isUpdating };
                set(this.messagesAtom, [...messages.slice(0, -1), updatedMessage]);
            }
        });
        this.removeLastMessageAtom = atom(null, (get, set) => {
            const messages = get(this.messagesAtom);
            messages.pop();
            set(this.messagesAtom, [...messages]);
        });
        this.simulateAssistantResponseAtom = atom(null, async (_, set, userMessage: ChatMessageType) => {
            // unused at the moment. can replace the temp() function in the future
            const typingMessage: ChatMessageType = {
                id: crypto.randomUUID(),
                user: "assistant",
                text: "",
            };

            // Add a typing indicator
            set(this.addMessageAtom, typingMessage);
            const parts = userMessage.text.split(" ");
            let currentPart = 0;
            while (currentPart < parts.length) {
                const part = parts[currentPart] + " ";
                set(this.updateLastMessageAtom, part, true);
                currentPart++;
            }
            set(this.updateLastMessageAtom, "", false);
        });

        this.mergedPresets = atom((get) => {
            const meta = get(this.blockAtom).meta;
            let settings = get(atoms.settingsAtom);
            let presetKey = get(this.presetKey);
            let presets = get(atoms.fullConfigAtom).presets;
            let selectedPresets = presets?.[presetKey] ?? {};

            let mergedPresets: MetaType = {};
            mergedPresets = mergeMeta(settings, selectedPresets, "ai");
            mergedPresets = mergeMeta(mergedPresets, meta, "ai");

            return mergedPresets;
        });

        this.aiOpts = atom((get) => {
            const mergedPresets = get(this.mergedPresets);

            const opts: WaveAIOptsType = {
                model: mergedPresets["ai:model"] ?? null,
                apitype: mergedPresets["ai:apitype"] ?? null,
                orgid: mergedPresets["ai:orgid"] ?? null,
                apitoken: mergedPresets["ai:apitoken"] ?? null,
                apiversion: mergedPresets["ai:apiversion"] ?? null,
                maxtokens: mergedPresets["ai:maxtokens"] ?? null,
                timeoutms: mergedPresets["ai:timeoutms"] ?? 60000,
                baseurl: mergedPresets["ai:baseurl"] ?? null,
            };
            return opts;
        });

        this.viewText = atom((get) => {
            const viewTextChildren: HeaderElem[] = [];
            const aiOpts = get(this.aiOpts);
            const presets = get(this.presetMap);
            const presetKey = get(this.presetKey);
            const presetName = presets[presetKey]?.["display:name"] ?? "";
            const isCloud = isBlank(aiOpts.apitoken) && isBlank(aiOpts.baseurl);

            // Handle known API providers
            switch (aiOpts?.apitype) {
                case "anthropic":
                    viewTextChildren.push({
                        elemtype: "iconbutton",
                        icon: "globe",
                        title: `Using Remote Anthropic API (${aiOpts.model})`,
                        noAction: true,
                    });
                    break;
                case "perplexity":
                    viewTextChildren.push({
                        elemtype: "iconbutton",
                        icon: "globe",
                        title: `Using Remote Perplexity API (${aiOpts.model})`,
                        noAction: true,
                    });
                    break;
                default:
                    if (isCloud) {
                        viewTextChildren.push({
                            elemtype: "iconbutton",
                            icon: "cloud",
                            title: "Using Wave's AI Proxy (gpt-4o-mini)",
                            noAction: true,
                        });
                    } else {
                        const baseUrl = aiOpts.baseurl ?? "OpenAI Default Endpoint";
                        const modelName = aiOpts.model;
                        if (baseUrl.startsWith("http://localhost") || baseUrl.startsWith("http://127.0.0.1")) {
                            viewTextChildren.push({
                                elemtype: "iconbutton",
                                icon: "location-dot",
                                title: `Using Local Model @ ${baseUrl} (${modelName})`,
                                noAction: true,
                            });
                        } else {
                            viewTextChildren.push({
                                elemtype: "iconbutton",
                                icon: "globe",
                                title: `Using Remote Model @ ${baseUrl} (${modelName})`,
                                noAction: true,
                            });
                        }
                    }
            }

            const dropdownItems = Object.entries(presets)
                .sort((a, b) => ((a[1]["display:order"] ?? 0) > (b[1]["display:order"] ?? 0) ? 1 : -1))
                .map(
                    (preset) =>
                        ({
                            label: preset[1]["display:name"],
                            onClick: () =>
                                fireAndForget(() =>
                                    ObjectService.UpdateObjectMeta(WOS.makeORef("block", this.blockId), {
                                        "ai:preset": preset[0],
                                    })
                                ),
                        }) as MenuItem
                );
            dropdownItems.push({
                label: "Add AI preset...",
                onClick: () => {
                    fireAndForget(async () => {
                        const path = `${getApi().getConfigDir()}/presets/ai.json`;
                        const blockDef: BlockDef = {
                            meta: {
                                view: "preview",
                                file: path,
                            },
                        };
                        await createBlock(blockDef, false, true);
                    });
                },
            });
            viewTextChildren.push({
                elemtype: "menubutton",
                text: presetName,
                title: "Select AI Configuration",
                items: dropdownItems,
            });
            return viewTextChildren;
        });
        this.endIconButtons = atom((_) => {
            let clearButton: IconButtonDecl = {
                elemtype: "iconbutton",
                icon: "delete-left",
                title: "Clear Chat History",
                click: this.clearMessages.bind(this),
            };
            return [clearButton];
        });
    }

    get viewComponent(): ViewComponent {
        return WaveAi;
    }

    dispose() {
        DefaultRouter.unregisterRoute(makeFeBlockRouteId(this.blockId));
    }

    async populateMessages(): Promise<void> {
        const history = await this.fetchAiData();
        globalStore.set(this.messagesAtom, history.map(promptToMsg));
    }

    async fetchAiData(): Promise<Array<WaveAIPromptMessageType>> {
        const { data } = await fetchWaveFile(this.blockId, "aidata");
        if (!data) {
            return [];
        }
        const history: Array<WaveAIPromptMessageType> = JSON.parse(new TextDecoder().decode(data));
        return history.slice(Math.max(history.length - slidingWindowSize, 0));
    }

    giveFocus(): boolean {
        if (this?.textAreaRef?.current) {
            this.textAreaRef.current?.focus();
            return true;
        }
        return false;
    }

    getAiName(): string {
        const blockMeta = globalStore.get(this.blockAtom)?.meta ?? {};
        const settings = globalStore.get(atoms.settingsAtom) ?? {};
        const name = blockMeta["ai:name"] ?? settings["ai:name"] ?? null;
        return name;
    }

    setLocked(locked: boolean) {
        globalStore.set(this.locked, locked);
    }

    sendMessage(text: string, user: string = "user") {
        const clientId = globalStore.get(atoms.clientId);
        this.setLocked(true);

        const newMessage: ChatMessageType = {
            id: crypto.randomUUID(),
            user,
            text,
        };
        globalStore.set(this.addMessageAtom, newMessage);
        // send message to backend and get response
        const opts = globalStore.get(this.aiOpts);

        // Get file attachments
        const fileAttachments = globalStore.get(this.fileAttachmentsAtom);

        const newPrompt: WaveAIPromptMessageType = {
            role: "user",
            content: text,
            file_attachments: fileAttachments.length > 0 ? fileAttachments : undefined,
        };

        // Clear file attachments after sending
        globalStore.set(this.clearFileAttachmentsAtom);
        const handleAiStreamingResponse = async () => {
            const typingMessage: ChatMessageType = {
                id: crypto.randomUUID(),
                user: "assistant",
                text: "",
            };

            // Add a typing indicator
            globalStore.set(this.addMessageAtom, typingMessage);
            const history = await this.fetchAiData();
            const beMsg: WaveAIStreamRequest = {
                clientid: clientId,
                opts: opts,
                prompt: [...history, newPrompt],
            };
            let fullMsg = "";
            try {
                const aiGen = RpcApi.StreamWaveAiCommand(TabRpcClient, beMsg, { timeout: opts.timeoutms });
                for await (const msg of aiGen) {
                    fullMsg += msg.text ?? "";
                    globalStore.set(this.updateLastMessageAtom, msg.text ?? "", true);
                    if (this.cancel) {
                        break;
                    }
                }
                if (fullMsg == "") {
                    // remove a message if empty
                    globalStore.set(this.removeLastMessageAtom);
                    // only save the author's prompt
                    await BlockService.SaveWaveAiData(this.blockId, [...history, newPrompt]);
                } else {
                    const responsePrompt: WaveAIPromptMessageType = {
                        role: "assistant",
                        content: fullMsg,
                    };
                    //mark message as complete
                    globalStore.set(this.updateLastMessageAtom, "", false);
                    // save a complete message prompt and response
                    await BlockService.SaveWaveAiData(this.blockId, [...history, newPrompt, responsePrompt]);
                }
            } catch (error) {
                const updatedHist = [...history, newPrompt];
                if (fullMsg == "") {
                    globalStore.set(this.removeLastMessageAtom);
                } else {
                    globalStore.set(this.updateLastMessageAtom, "", false);
                    const responsePrompt: WaveAIPromptMessageType = {
                        role: "assistant",
                        content: fullMsg,
                    };
                    updatedHist.push(responsePrompt);
                }
                const errMsg: string = (error as Error).message;
                const errorMessage: ChatMessageType = {
                    id: crypto.randomUUID(),
                    user: "error",
                    text: errMsg,
                };
                globalStore.set(this.addMessageAtom, errorMessage);
                globalStore.set(this.updateLastMessageAtom, "", false);
                const errorPrompt: WaveAIPromptMessageType = {
                    role: "error",
                    content: errMsg,
                };
                updatedHist.push(errorPrompt);
                await BlockService.SaveWaveAiData(this.blockId, updatedHist);
            }
            this.setLocked(false);
            this.cancel = false;
        };
        fireAndForget(handleAiStreamingResponse);
    }

    useWaveAi() {
        return {
            sendMessage: this.sendMessage.bind(this) as (text: string) => void,
            addFileAttachment: (attachment: FileAttachment) => globalStore.set(this.addFileAttachmentAtom, attachment),
            removeFileAttachment: (filePath: string) => globalStore.set(this.removeFileAttachmentAtom, filePath),
            clearFileAttachments: () => globalStore.set(this.clearFileAttachmentsAtom),
            getFileAttachments: () => globalStore.get(this.fileAttachmentsAtom),
        };
    }

    async clearMessages() {
        await BlockService.SaveWaveAiData(this.blockId, []);
        globalStore.set(this.messagesAtom, []);
    }

    keyDownHandler(waveEvent: WaveKeyboardEvent): boolean {
        if (checkKeyPressed(waveEvent, "Cmd:l")) {
            fireAndForget(this.clearMessages.bind(this));
            return true;
        }
        return false;
    }

    executeInTerminal(command: string) {
        console.log("%c executeInTerminal called with command:", "background: #ff0; color: #000", command);

        fireAndForget(async () => {
            try {
                // First, check if the TabRpcClient is available
                if (!TabRpcClient) {
                    console.error("TabRpcClient is not available");
                    alert("Failed to execute command: TabRpcClient is not available");
                    return;
                }

                // Get the tab ID from the block state
                const blockState = globalStore.get(this.blockAtom);
                console.log("%c Block state:", "background: #ff0; color: #000", blockState);

                // First try to get tab ID from the "parent" property in meta
                let tabId = blockState?.meta?.["parent"];
                console.log("%c Tab ID from block parent:", "background: #ff0; color: #000", tabId);

                // If that fails, try to use the staticTabId from global atoms (this is the current tab)
                if (!tabId) {
                    try {
                        tabId = globalStore.get(atoms.staticTabId);
                        console.log("%c Using static tab ID:", "background: #ff0; color: #000", tabId);
                    } catch (err) {
                        console.error("Error getting static tab ID:", err);
                    }
                }

                // If still no tab ID, fail gracefully
                if (!tabId) {
                    console.error("Could not determine tab ID from any source");
                    alert("Failed to execute command: Could not determine which tab to use. Please report this issue.");
                    return;
                }

                // Try to find existing terminal blocks in the tab
                let existingTerminalBlockId = null;
                try {
                    // Get tab info which should include blocks
                    const tabInfo = await RpcApi.GetTabCommand(TabRpcClient, tabId);
                    console.log("%c Tab info:", "background: #ff0; color: #000", tabInfo);

                    // Look for terminal blocks in this tab
                    const allBlockIds = tabInfo?.blockids || [];

                    // Find the most recently used terminal block, if any exists
                    for (let i = allBlockIds.length - 1; i >= 0; i--) {
                        const blockId = allBlockIds[i];
                        try {
                            const blockInfo = await RpcApi.BlockInfoCommand(TabRpcClient, blockId);

                            if (blockInfo?.block?.meta?.view === "term") {
                                existingTerminalBlockId = blockId;
                                console.log(
                                    "%c Found existing terminal block:",
                                    "background: #ff0; color: #000",
                                    existingTerminalBlockId
                                );
                                break;
                            }
                        } catch (blockErr) {
                            console.error("Error getting block info:", blockErr);
                        }
                    }
                } catch (tabErr) {
                    console.error("Error getting tab info:", tabErr);
                }

                if (existingTerminalBlockId) {
                    // Reuse an existing terminal block by sending the command as input
                    console.log(
                        "%c Sending command to existing terminal block:",
                        "background: #ff0; color: #000",
                        existingTerminalBlockId
                    );

                    // Add a newline to the command so it executes
                    const commandWithNewline = command + "\n";
                    const inputData64 = stringToBase64(commandWithNewline);

                    // Send the command to the terminal
                    await RpcApi.ControllerInputCommand(TabRpcClient, {
                        blockid: existingTerminalBlockId,
                        inputdata64: inputData64,
                    });

                    console.log(
                        "%c Command sent to terminal block:",
                        "background: #ff0; color: #000",
                        existingTerminalBlockId
                    );
                } else {
                    // No existing terminal block found, create a new one
                    console.log("%c Creating new terminal block:", "background: #ff0; color: #000");

                    const blockId = await RpcApi.CreateBlockCommand(TabRpcClient, {
                        tabid: tabId,
                        blockdef: {
                            meta: {
                                view: "term",
                                controller: "cmd",
                                cmd: command,
                                "cmd:runonstart": true,
                                "cmd:clearonstart": true,
                                "cmd:shell": true,
                            },
                        },
                    });

                    console.log("%c Created new terminal block:", "background: #ff0; color: #000", blockId);
                }
            } catch (err) {
                console.error("Error executing command in terminal:", err);
                alert(`Failed to execute command: ${err.message}`);
            }
        });
    }
}

const ChatItem = ({ chatItemAtom, model }: ChatItemProps) => {
    const chatItem = useAtomValue(chatItemAtom);
    const { user, text } = chatItem;
    const fontSize = useAtomValue(model.mergedPresets)?.["ai:fontsize"];
    const fixedFontSize = useAtomValue(model.mergedPresets)?.["ai:fixedfontsize"];

    // Function to check if a message contains executable commands
    const hasExecutableCommands = useMemo(() => {
        if (!text) return false;

        // Check for code blocks
        const codeBlockRegex = /```(?:bash|shell|sh)?\n([\s\S]*?)```/g;
        let hasCommands = codeBlockRegex.test(text);

        // If no code blocks, check for $ prefixed commands
        if (!hasCommands) {
            const dollarRegex = /\$\s+([^\n]+)/g;
            hasCommands = dollarRegex.test(text);
        }

        // If still no commands, check for lines that look like commands
        if (!hasCommands) {
            const lines = text.split("\n");
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (
                    trimmedLine &&
                    !trimmedLine.startsWith("#") &&
                    !trimmedLine.includes("```") &&
                    !trimmedLine.includes("**") &&
                    /^(git|cd|ls|mkdir|rm|mv|cp|cat|echo|touch|find|grep|curl|wget|npm|yarn|python|node|go)/i.test(
                        trimmedLine
                    )
                ) {
                    hasCommands = true;
                    break;
                }
            }
        }

        return hasCommands;
    }, [text]);

    const handleExecuteCommand = useCallback(
        async (command: string) => {
            console.log("%c handleExecuteCommand with command:", "background: #0f0; color: #000", command);
            model.executeInTerminal(command);
            return new Promise<void>((resolve) => setTimeout(resolve, 500));
        },
        [model]
    );

    const renderContent = useMemo(() => {
        if (user == "error") {
            return (
                <>
                    <div className="chat-msg chat-msg-header">
                        <div className="icon-box">
                            <i className="fa-sharp fa-solid fa-circle-exclamation"></i>
                        </div>
                    </div>
                    <div className="chat-msg chat-msg-error">
                        <Markdown
                            text={text}
                            scrollable={true}
                            fontSizeOverride={fontSize}
                            fixedFontSizeOverride={fixedFontSize}
                        />
                    </div>
                </>
            );
        }
        if (user == "assistant") {
            return text ? (
                <div className="assistant-message-wrapper">
                    <div className="chat-msg chat-msg-header">
                        <div className="icon-box">
                            <i className="fa-sharp fa-solid fa-sparkles"></i>
                        </div>
                    </div>
                    <div className="chat-msg chat-msg-assistant">
                        <Markdown
                            text={text}
                            scrollable={true}
                            fontSizeOverride={fontSize}
                            fixedFontSizeOverride={fixedFontSize}
                            onClickExecute={handleExecuteCommand}
                        />
                    </div>
                    {/* Only show autonomous mode toggle when message contains commands */}
                    {hasExecutableCommands && (
                        <div className="autonomous-mode-container">
                            <AutonomousModeToggle messageText={text} onExecuteCommand={handleExecuteCommand} />
                        </div>
                    )}
                </div>
            ) : (
                <>
                    <div className="chat-msg-header">
                        <i className="fa-sharp fa-solid fa-sparkles"></i>
                    </div>
                    <TypingIndicator className="chat-msg typing-indicator" />
                </>
            );
        }
        return (
            <>
                <div className="chat-msg chat-msg-user">
                    <Markdown
                        className="msg-text"
                        text={text}
                        scrollable={true}
                        fontSizeOverride={fontSize}
                        fixedFontSizeOverride={fixedFontSize}
                    />
                </div>
            </>
        );
    }, [text, user, fontSize, fixedFontSize, handleExecuteCommand]);

    return <div className={"chat-msg-container"}>{renderContent}</div>;
};

interface ChatWindowProps {
    chatWindowRef: React.RefObject<HTMLDivElement>;
    msgWidths: Object;
    model: WaveAiModel;
}

const ChatWindow = memo(
    forwardRef<OverlayScrollbarsComponentRef, ChatWindowProps>(({ chatWindowRef, msgWidths, model }, ref) => {
        const isUserScrolling = useRef(false);
        const osRef = useRef<OverlayScrollbarsComponentRef>(null);
        const splitMessages = useAtomValue(model.messagesSplitAtom) as Atom<ChatMessageType>[];
        const latestMessage = useAtomValue(model.latestMessageAtom);
        const prevMessagesLenRef = useRef(splitMessages.length);

        useImperativeHandle(ref, () => osRef.current as OverlayScrollbarsComponentRef);

        const handleNewMessage = useCallback(
            throttle(100, (messagesLen: number) => {
                if (osRef.current?.osInstance()) {
                    const { viewport } = osRef.current.osInstance().elements();
                    if (prevMessagesLenRef.current !== messagesLen || !isUserScrolling.current) {
                        viewport.scrollTo({
                            behavior: "auto",
                            top: chatWindowRef.current?.scrollHeight || 0,
                        });
                    }

                    prevMessagesLenRef.current = messagesLen;
                }
            }),
            []
        );

        useEffect(() => {
            handleNewMessage(splitMessages.length);
        }, [splitMessages, latestMessage]);

        // Wait 300 ms after the user stops scrolling to determine if the user is within 300px of the bottom of the chat window.
        // If so, unset the user scrolling flag.
        const determineUnsetScroll = useCallback(
            debounce(300, () => {
                const { viewport } = osRef.current.osInstance().elements();
                if (viewport.scrollTop > chatWindowRef.current?.clientHeight - viewport.clientHeight - 100) {
                    isUserScrolling.current = false;
                }
            }),
            []
        );

        const handleUserScroll = useCallback(
            throttle(100, () => {
                isUserScrolling.current = true;
                determineUnsetScroll();
            }),
            []
        );

        useEffect(() => {
            if (osRef.current?.osInstance()) {
                const { viewport } = osRef.current.osInstance().elements();

                viewport.addEventListener("wheel", handleUserScroll, { passive: true });
                viewport.addEventListener("touchmove", handleUserScroll, { passive: true });

                return () => {
                    viewport.removeEventListener("wheel", handleUserScroll);
                    viewport.removeEventListener("touchmove", handleUserScroll);
                    if (osRef.current && osRef.current.osInstance()) {
                        osRef.current.osInstance().destroy();
                    }
                };
            }
        }, []);

        const handleScrollbarInitialized = (instance: OverlayScrollbars) => {
            const { viewport } = instance.elements();
            viewport.removeAttribute("tabindex");
            viewport.scrollTo({
                behavior: "auto",
                top: chatWindowRef.current?.scrollHeight || 0,
            });
        };

        const handleScrollbarUpdated = (instance: OverlayScrollbars) => {
            const { viewport } = instance.elements();
            viewport.removeAttribute("tabindex");
        };

        return (
            <OverlayScrollbarsComponent
                ref={osRef}
                className="chat-window-container"
                options={{ scrollbars: { autoHide: "leave" } }}
                events={{ initialized: handleScrollbarInitialized, updated: handleScrollbarUpdated }}
            >
                <div ref={chatWindowRef} className="chat-window" style={msgWidths}>
                    <div className="filler"></div>
                    {splitMessages.map((chitem, idx) => (
                        <ChatItem key={idx} chatItemAtom={chitem} model={model} />
                    ))}
                </div>
            </OverlayScrollbarsComponent>
        );
    })
);

interface ChatInputProps {
    value: string;
    baseFontSize: number;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onMouseDown: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
    model: WaveAiModel;
    onAtCharacter: (position: number) => void;
}

const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
    ({ value, onChange, onKeyDown, onMouseDown, baseFontSize, model, onAtCharacter }, ref) => {
        const textAreaRef = useRef<HTMLTextAreaElement>(null);

        useImperativeHandle(ref, () => textAreaRef.current as HTMLTextAreaElement);

        useEffect(() => {
            model.textAreaRef = textAreaRef;
        }, []);

        const adjustTextAreaHeight = useCallback(
            (value: string) => {
                if (textAreaRef.current == null) {
                    return;
                }

                // Adjust the height of the textarea to fit the text
                const textAreaMaxLines = 5;
                const textAreaLineHeight = baseFontSize * 1.5;
                const textAreaMinHeight = textAreaLineHeight;
                const textAreaMaxHeight = textAreaLineHeight * textAreaMaxLines;

                if (value === "") {
                    textAreaRef.current.style.height = `${textAreaLineHeight}px`;
                    return;
                }

                textAreaRef.current.style.height = `${textAreaLineHeight}px`;
                const scrollHeight = textAreaRef.current.scrollHeight;
                const newHeight = Math.min(Math.max(scrollHeight, textAreaMinHeight), textAreaMaxHeight);
                textAreaRef.current.style.height = newHeight + "px";
            },
            [baseFontSize]
        );

        useEffect(() => {
            adjustTextAreaHeight(value);
        }, [value]);

        // Handle input to detect '@' character
        const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
            const target = e.target as HTMLTextAreaElement;
            const value = target.value;
            const cursorPosition = target.selectionStart;

            // Check if the character at the current cursor position is "@"
            if (value.charAt(cursorPosition - 1) === "@") {
                console.log("@ character detected at position:", cursorPosition);
                onAtCharacter(cursorPosition);
            }
        };

        return (
            <textarea
                ref={textAreaRef}
                autoComplete="off"
                autoCorrect="off"
                className="waveai-input"
                onMouseDown={onMouseDown} // When the user clicks on the textarea
                onChange={onChange}
                onKeyDown={onKeyDown}
                onInput={handleInput}
                style={{ fontSize: baseFontSize }}
                placeholder="Ask anything... (type @ to select files)"
                value={value}
            ></textarea>
        );
    }
);

const WaveAi = ({ model }: { model: WaveAiModel; blockId: string }) => {
    const { sendMessage, addFileAttachment, removeFileAttachment, getFileAttachments } = model.useWaveAi();
    const waveaiRef = useRef<HTMLDivElement>(null);
    const chatWindowRef = useRef<HTMLDivElement>(null);
    const osRef = useRef<OverlayScrollbarsComponentRef>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const [value, setValue] = useState("");
    const [selectedBlockIdx, setSelectedBlockIdx] = useState<number | null>(null);
    const [showFilePicker, setShowFilePicker] = useState(false);
    const [currentDir, setCurrentDir] = useState("");
    const [atCharPosition, setAtCharPosition] = useState<number | null>(null);

    // Get the current working directory from the active terminal
    useEffect(() => {
        const getCurrentWorkingDir = async () => {
            try {
                console.log("Getting current working directory for block:", model.blockId);

                // Get the parent tab ID from the block
                const blockInfo = await RpcApi.BlockInfoCommand(TabRpcClient, model.blockId);
                console.log("Block info:", blockInfo);

                // Get the parent tab ID from the block's metadata
                let tabId = blockInfo?.block?.meta?.["parent"];
                console.log("Parent tab ID:", tabId);

                // If that fails, try to use the staticTabId from global atoms (this is the current tab)
                if (!tabId) {
                    try {
                        const staticTabId = globalStore.get(atoms.staticTabId);
                        console.log("Using static tab ID:", staticTabId);
                        if (staticTabId) {
                            tabId = staticTabId;
                        }
                    } catch (err) {
                        console.error("Error getting static tab ID:", err);
                    }
                }

                if (tabId) {
                    // Get tab info to find terminal blocks
                    const tabInfo = await RpcApi.GetTabCommand(TabRpcClient, tabId);
                    console.log("Tab info:", tabInfo);

                    if (tabInfo?.blockids?.length) {
                        console.log("Found", tabInfo.blockids.length, "blocks in tab");

                        // Find the most recently used terminal block, if any exists
                        // This matches the approach used in executeInTerminal
                        let existingTerminalBlockId = null;
                        const allBlockIds = tabInfo?.blockids || [];

                        for (let i = allBlockIds.length - 1; i >= 0; i--) {
                            const blockId = allBlockIds[i];
                            try {
                                const blockInfo = await RpcApi.BlockInfoCommand(TabRpcClient, blockId);

                                if (blockInfo?.block?.meta?.view === "term") {
                                    existingTerminalBlockId = blockId;
                                    console.log("Found existing terminal block:", existingTerminalBlockId);
                                    break;
                                }
                            } catch (blockErr) {
                                console.error("Error getting block info:", blockErr);
                            }
                        }

                        // If we found a terminal block, get its current state
                        if (existingTerminalBlockId) {
                            try {
                                // Get the terminal block info to find the current working directory
                                // We'll use the block metadata directly since that's the most reliable source
                                const blockInfo = await RpcApi.BlockInfoCommand(TabRpcClient, existingTerminalBlockId);
                                console.log("Terminal block metadata:", blockInfo?.block?.meta);

                                // Try to get the current working directory from the block metadata
                                const possibleKeys = ["cwd", "term:cwd", "cmd:cwd", "shell:cwd", "pwd", "dir", "path"];

                                for (const key of possibleKeys) {
                                    if (blockInfo?.block?.meta?.[key]) {
                                        const cwd = blockInfo.block.meta[key];
                                        console.log(`Found CWD in metadata key "${key}":`, cwd);
                                        setCurrentDir(cwd);
                                        return;
                                    }
                                }
                            } catch (err) {
                                console.error("Error getting terminal state:", err);
                            }
                        }
                    }
                }

                // If we still don't have a directory, try to get the workspace directory
                try {
                    const workspace = globalStore.get(atoms.workspace);
                    console.log("Workspace:", workspace);

                    // Try to find a directory property in the workspace object
                    if (workspace) {
                        // Check various possible property names for the directory
                        const dirProps = ["dir", "directory", "path", "workingDir", "cwd"];
                        for (const prop of dirProps) {
                            if (workspace[prop]) {
                                console.log(`Found workspace directory in property "${prop}":`, workspace[prop]);
                                setCurrentDir(workspace[prop]);
                                return;
                            }
                        }
                    }
                } catch (workspaceError) {
                    console.error("Error getting workspace directory:", workspaceError);
                }

                // Try to use the source directory from the environment
                const sourceDir = "/Users/alex/source/waveterm";
                console.log("Using source directory:", sourceDir);
                setCurrentDir(sourceDir);
            } catch (error) {
                console.error("Error getting current working directory:", error);
                setCurrentDir(".");
            }
        };

        getCurrentWorkingDir();
    }, [model.blockId]);

    const baseFontSize: number = 14;
    const msgWidths = {};
    const locked = useAtomValue(model.locked);
    const fileAttachments = useAtomValue(model.fileAttachmentsAtom);

    // a weird workaround to initialize ansynchronously
    useEffect(() => {
        fireAndForget(model.populateMessages.bind(model));
    }, []);

    const handleTextAreaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setValue(e.target.value);
    };

    const handleFileSelect = async (filePath: string) => {
        try {
            console.log("File selected:", filePath);
            console.log("Current atCharPosition:", atCharPosition);
            console.log("Current value:", value);

            const attachment = await RpcApi.AiAttachFileCommand(TabRpcClient, filePath, {});
            if (attachment) {
                addFileAttachment(attachment);
                setShowFilePicker(false);

                // Insert the file name at the position of the "@" character
                if (atCharPosition !== null) {
                    const fileName = attachment.file_name;
                    console.log("File name to insert:", fileName);

                    // Get the parts of the string before and after the "@" character
                    const beforeAt = value.substring(0, atCharPosition - 1);
                    const afterAt = value.substring(atCharPosition);

                    // Create the new value with the file name inserted
                    const newValue = beforeAt + `@${fileName}` + afterAt;
                    console.log("New value after insertion:", newValue);

                    // Update the input value
                    setValue(newValue);

                    // Focus the input field after insertion
                    setTimeout(() => {
                        if (inputRef.current) {
                            inputRef.current.focus();
                            // Place cursor at the end of the inserted file name
                            const newCursorPosition = atCharPosition + fileName.length;
                            inputRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
                        }
                    }, 0);

                    // Reset the position
                    setAtCharPosition(null);
                } else {
                    console.log("atCharPosition is null, cannot insert file name");
                }
            }
        } catch (error) {
            console.error("Error attaching file:", error);
        }
    };

    const handleShowFilePicker = (position: number) => {
        console.log("Setting atCharPosition to:", position);
        setAtCharPosition(position);
        setShowFilePicker(true);
    };

    const updatePreTagOutline = (clickedPre?: HTMLElement | null) => {
        const pres = chatWindowRef.current?.querySelectorAll("pre");
        if (!pres) return;

        pres.forEach((preElement, idx) => {
            if (preElement === clickedPre) {
                setSelectedBlockIdx(idx);
            } else {
                preElement.style.outline = "none";
            }
        });

        if (clickedPre) {
            clickedPre.style.outline = outline;
        }
    };

    useEffect(() => {
        if (selectedBlockIdx !== null) {
            const pres = chatWindowRef.current?.querySelectorAll("pre");
            if (pres && pres[selectedBlockIdx]) {
                pres[selectedBlockIdx].style.outline = outline;
            }
        }
    }, [selectedBlockIdx]);

    const handleTextAreaMouseDown = () => {
        updatePreTagOutline();
        setSelectedBlockIdx(null);
    };

    const handleEnterKeyPressed = useCallback(() => {
        // using globalStore to avoid potential timing problems
        // useAtom means the component must rerender once before
        // the unlock is detected. this automatically checks on the
        // callback firing instead
        const locked = globalStore.get(model.locked);
        if (locked || value === "") return;

        sendMessage(value);
        setValue("");
        setSelectedBlockIdx(null);
    }, [value]);

    const updateScrollTop = () => {
        const pres = chatWindowRef.current?.querySelectorAll("pre");
        if (!pres || selectedBlockIdx === null) return;

        const block = pres[selectedBlockIdx];
        if (!block || !osRef.current?.osInstance()) return;

        const { viewport, scrollOffsetElement } = osRef.current?.osInstance().elements();
        const chatWindowTop = scrollOffsetElement.scrollTop;
        const chatWindowHeight = chatWindowRef.current.clientHeight;
        const chatWindowBottom = chatWindowTop + chatWindowHeight;
        const elemTop = block.offsetTop;
        const elemBottom = elemTop + block.offsetHeight;
        const elementIsInView = elemBottom <= chatWindowBottom && elemTop >= chatWindowTop;

        if (!elementIsInView) {
            let scrollPosition;
            if (elemBottom > chatWindowBottom) {
                scrollPosition = elemTop - chatWindowHeight + block.offsetHeight + 15;
            } else if (elemTop < chatWindowTop) {
                scrollPosition = elemTop - 15;
            }
            viewport.scrollTo({
                behavior: "auto",
                top: scrollPosition,
            });
        }
    };

    const shouldSelectCodeBlock = (key: "ArrowUp" | "ArrowDown") => {
        const textarea = inputRef.current;
        const cursorPosition = textarea?.selectionStart || 0;
        const textBeforeCursor = textarea?.value.slice(0, cursorPosition) || "";

        return (
            (textBeforeCursor.indexOf("\n") === -1 && cursorPosition === 0 && key === "ArrowUp") ||
            selectedBlockIdx !== null
        );
    };

    const handleArrowUpPressed = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (shouldSelectCodeBlock("ArrowUp")) {
            e.preventDefault();
            const pres = chatWindowRef.current?.querySelectorAll("pre");
            let blockIndex = selectedBlockIdx;
            if (!pres) return;
            if (blockIndex === null) {
                setSelectedBlockIdx(pres.length - 1);
            } else if (blockIndex > 0) {
                blockIndex--;
                setSelectedBlockIdx(blockIndex);
            }
            updateScrollTop();
        }
    };

    const handleArrowDownPressed = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (shouldSelectCodeBlock("ArrowDown")) {
            e.preventDefault();
            const pres = chatWindowRef.current?.querySelectorAll("pre");
            let blockIndex = selectedBlockIdx;
            if (!pres) return;
            if (blockIndex === null) return;
            if (blockIndex < pres.length - 1 && blockIndex >= 0) {
                setSelectedBlockIdx(++blockIndex);
                updateScrollTop();
            } else {
                inputRef.current.focus();
                setSelectedBlockIdx(null);
            }
            updateScrollTop();
        }
    };

    const handleTextAreaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const waveEvent = adaptFromReactOrNativeKeyEvent(e);
        if (checkKeyPressed(waveEvent, "Enter")) {
            e.preventDefault();
            handleEnterKeyPressed();
        } else if (checkKeyPressed(waveEvent, "ArrowUp")) {
            handleArrowUpPressed(e);
        } else if (checkKeyPressed(waveEvent, "ArrowDown")) {
            handleArrowDownPressed(e);
        }
    };

    let buttonClass = "waveai-submit-button";
    let buttonIcon = makeIconClass("arrow-up", false);
    let buttonTitle = "run";
    if (locked) {
        buttonClass = "waveai-submit-button stop";
        buttonIcon = makeIconClass("stop", false);
        buttonTitle = "stop";
    }
    const handleButtonPress = useCallback(() => {
        if (locked) {
            model.cancel = true;
        } else {
            handleEnterKeyPressed();
        }
    }, [locked, handleEnterKeyPressed]);

    return (
        <div ref={waveaiRef} className="waveai">
            <div className="waveai-chat">
                <ChatWindow ref={osRef} chatWindowRef={chatWindowRef} msgWidths={msgWidths} model={model} />
            </div>
            <div className="waveai-controls">
                <div className="waveai-input-wrapper">
                    {fileAttachments.length > 0 && (
                        <div className="file-attachments-container">
                            <div className="file-attachments-label">Attached Files:</div>
                            <FileAttachmentList attachments={fileAttachments} onRemove={removeFileAttachment} />
                        </div>
                    )}
                    <ChatInput
                        ref={inputRef}
                        value={value}
                        model={model}
                        onChange={handleTextAreaChange}
                        onKeyDown={handleTextAreaKeyDown}
                        onMouseDown={handleTextAreaMouseDown}
                        onAtCharacter={handleShowFilePicker}
                        baseFontSize={baseFontSize}
                    />
                    <FileAttachmentButton onAttach={handleFileSelect} currentDir={currentDir} />
                </div>
                {showFilePicker && (
                    <FilePicker
                        isOpen={showFilePicker}
                        onClose={() => setShowFilePicker(false)}
                        onSelect={handleFileSelect}
                        currentDir={currentDir}
                    />
                )}
                <Button className={buttonClass} onClick={handleButtonPress}>
                    <i className={buttonIcon} title={buttonTitle} />
                </Button>
            </div>
        </div>
    );
};

export { WaveAi };
