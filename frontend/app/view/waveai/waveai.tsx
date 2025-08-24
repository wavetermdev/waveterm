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
import { fireAndForget, isBlank, makeIconClass, mergeMeta } from "@/util/util";
import { atom, Atom, PrimitiveAtom, useAtomValue, WritableAtom } from "jotai";
import { splitAtom } from "jotai/utils";
import type { OverlayScrollbars } from "overlayscrollbars";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { debounce, throttle } from "throttle-debounce";
import "./waveai.scss";
import { WaveAiUseChat, WaveAiUseChatModel } from "./waveaiusechat";

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
                proxyurl: mergedPresets["ai:proxyurl"] ?? null,
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
        // Check if we should use the new useChat implementation
        const useNewImplementation = this.shouldUseNewImplementation();
        return useNewImplementation ? WaveAiUseChat : WaveAi;
    }

    private shouldUseNewImplementation(): boolean {
        // For now, check for a meta flag to enable the new implementation
        const blockMeta = globalStore.get(this.blockAtom)?.meta ?? {};
        return blockMeta["ai:usechat"] === "true" || blockMeta["ai:usechat"] === true;
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
        const newPrompt: WaveAIPromptMessageType = {
            role: "user",
            content: text,
        };
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
}

const ChatItem = ({ chatItemAtom, model }: ChatItemProps) => {
    const chatItem = useAtomValue(chatItemAtom);
    const { user, text } = chatItem;
    const fontSize = useAtomValue(model.mergedPresets)?.["ai:fontsize"];
    const fixedFontSize = useAtomValue(model.mergedPresets)?.["ai:fixedfontsize"];
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
                            scrollable={false}
                            fontSizeOverride={fontSize}
                            fixedFontSizeOverride={fixedFontSize}
                        />
                    </div>
                </>
            );
        }
        if (user == "assistant") {
            return text ? (
                <>
                    <div className="chat-msg chat-msg-header">
                        <div className="icon-box">
                            <i className="fa-sharp fa-solid fa-sparkles"></i>
                        </div>
                    </div>
                    <div className="chat-msg chat-msg-assistant">
                        <Markdown
                            text={text}
                            scrollable={false}
                            fontSizeOverride={fontSize}
                            fixedFontSizeOverride={fixedFontSize}
                        />
                    </div>
                </>
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
                        scrollable={false}
                        fontSizeOverride={fontSize}
                        fixedFontSizeOverride={fixedFontSize}
                    />
                </div>
            </>
        );
    }, [text, user, fontSize, fixedFontSize]);

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
}

const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
    ({ value, onChange, onKeyDown, onMouseDown, baseFontSize, model }, ref) => {
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

        return (
            <textarea
                ref={textAreaRef}
                autoComplete="off"
                autoCorrect="off"
                className="waveai-input"
                onMouseDown={onMouseDown} // When the user clicks on the textarea
                onChange={onChange}
                onKeyDown={onKeyDown}
                style={{ fontSize: baseFontSize }}
                placeholder="Ask anything..."
                value={value}
            ></textarea>
        );
    }
);

const WaveAiOld = ({ model }: { model: WaveAiModel; blockId: string }) => {
    const { sendMessage } = model.useWaveAi();
    const waveaiRef = useRef<HTMLDivElement>(null);
    const chatWindowRef = useRef<HTMLDivElement>(null);
    const osRef = useRef<OverlayScrollbarsComponentRef>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const [value, setValue] = useState("");
    const [selectedBlockIdx, setSelectedBlockIdx] = useState<number | null>(null);

    const baseFontSize: number = 14;
    const msgWidths = {};
    const locked = useAtomValue(model.locked);

    // a weird workaround to initialize ansynchronously
    useEffect(() => {
        fireAndForget(model.populateMessages.bind(model));
    }, []);

    const handleTextAreaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setValue(e.target.value);
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
                    <ChatInput
                        ref={inputRef}
                        value={value}
                        model={model}
                        onChange={handleTextAreaChange}
                        onKeyDown={handleTextAreaKeyDown}
                        onMouseDown={handleTextAreaMouseDown}
                        baseFontSize={baseFontSize}
                    />
                </div>
                <Button className={buttonClass} onClick={handleButtonPress}>
                    <i className={buttonIcon} title={buttonTitle} />
                </Button>
            </div>
        </div>
    );
};

const WaveAi = ({ model, blockId }: { model: WaveAiModel; blockId: string }) => {
    const useNewImplementation = true;

    if (useNewImplementation) {
        const useChatModel = useMemo(() => new WaveAiUseChatModel(blockId), [blockId]);
        return <WaveAiUseChat model={useChatModel} blockId={blockId} />;
    }

    return <WaveAiOld model={model} blockId={blockId} />;
};

export { WaveAi };
