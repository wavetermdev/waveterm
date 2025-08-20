// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Streamdown } from "streamdown";
import { TypingIndicator } from "@/app/element/typingindicator";
import { atoms, fetchWaveFile, WOS } from "@/store/global";
import { BlockService, ObjectService } from "@/store/services";
import { getWebServerEndpoint } from "@/util/endpoints";
import { checkKeyPressed } from "@/util/keyutil";
import { fireAndForget, isBlank, mergeMeta } from "@/util/util";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { atom, Atom, useAtomValue } from "jotai";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { debounce, throttle } from "throttle-debounce";

interface WaveAiUseChatProps {
    blockId: string;
    model: WaveAiUseChatModelImpl;
}

interface ChatMessage {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    reasoning?: string;
}

const slidingWindowSize = 30;

class WaveAiUseChatModelImpl implements ViewModel {
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
    endIconButtons?: Atom<IconButtonDecl[]>;
    textAreaRef: React.RefObject<HTMLTextAreaElement>;

    constructor(blockId: string) {
        this.viewType = "waveai";
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = atom("sparkles");
        this.viewName = atom("Wave AI");
        this.textAreaRef = React.createRef();

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
        return WaveAiUseChat;
    }

    dispose() {
        // No cleanup needed for useChat version
    }

    async populateMessages(): Promise<ChatMessage[]> {
        const history = await this.fetchAiData();
        return history.map((msg) => ({
            id: crypto.randomUUID(),
            role: msg.role as "user" | "assistant" | "system",
            content: msg.content,
        }));
    }

    async fetchAiData(): Promise<Array<WaveAIPromptMessageType>> {
        const { data } = await fetchWaveFile(this.blockId, "aidata");
        if (!data) {
            return [];
        }
        const history: Array<WaveAIPromptMessageType> = JSON.parse(new TextDecoder().decode(data));
        return history.slice(Math.max(history.length - slidingWindowSize, 0));
    }

    async saveMessages(messages: ChatMessage[]): Promise<void> {
        const history: WaveAIPromptMessageType[] = messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
        }));
        await BlockService.SaveWaveAiData(this.blockId, history);
    }

    giveFocus(): boolean {
        if (this?.textAreaRef?.current) {
            this.textAreaRef.current?.focus();
            return true;
        }
        return false;
    }

    async clearMessages() {
        await BlockService.SaveWaveAiData(this.blockId, []);
    }

    keyDownHandler(waveEvent: WaveKeyboardEvent): boolean {
        if (checkKeyPressed(waveEvent, "Cmd:l")) {
            fireAndForget(this.clearMessages.bind(this));
            return true;
        }
        return false;
    }
}

const ChatWindow = memo(
    forwardRef<
        OverlayScrollbarsComponentRef,
        { messages: ChatMessage[]; isLoading: boolean; error: Error | null; fontSize?: string; fixedFontSize?: string }
    >(({ messages, isLoading, error, fontSize, fixedFontSize }, ref) => {
        const osRef = useRef<OverlayScrollbarsComponentRef>(null);
        const [userHasScrolled, setUserHasScrolled] = useState(false);
        const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

        useImperativeHandle(ref, () => osRef.current!, []);

        const scrollToBottom = useCallback(() => {
            if (osRef.current && shouldAutoScroll) {
                const viewport = osRef.current.osInstance()?.elements().viewport;
                if (viewport) {
                    viewport.scrollTop = viewport.scrollHeight;
                }
            }
        }, [shouldAutoScroll]);

        const handleScroll = useMemo(
            () =>
                throttle(100, () => {
                    if (osRef.current) {
                        const viewport = osRef.current.osInstance()?.elements().viewport;
                        if (viewport) {
                            const { scrollTop, scrollHeight, clientHeight } = viewport;
                            const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
                            setShouldAutoScroll(isNearBottom);
                            if (!isNearBottom && !userHasScrolled) {
                                setUserHasScrolled(true);
                            }
                        }
                    }
                }),
            [userHasScrolled]
        );

        const resetUserScroll = useMemo(
            () =>
                debounce(300, () => {
                    setUserHasScrolled(false);
                }),
            []
        );

        useEffect(() => {
            scrollToBottom();
        }, [messages, isLoading, scrollToBottom]);

        useEffect(() => {
            if (shouldAutoScroll && userHasScrolled) {
                resetUserScroll();
            }
        }, [shouldAutoScroll, userHasScrolled, resetUserScroll]);

        return (
            <div className="flex-1 overflow-hidden">
                <OverlayScrollbarsComponent
                    ref={osRef}
                    className="h-full"
                    options={{ scrollbars: { autoHide: "leave" } }}
                    events={{ scroll: handleScroll }}
                >
                    <div className="flex flex-col gap-4 p-4">
                        {messages.map((message) => (
                            <ChatItem
                                key={message.id}
                                message={message}
                                fontSize={fontSize}
                                fixedFontSize={fixedFontSize}
                            />
                        ))}
                        {isLoading && (
                            <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-8 h-8 bg-accent/10 rounded-md flex items-center justify-center">
                                    <i className="fa-sharp fa-solid fa-sparkles text-accent"></i>
                                </div>
                                <TypingIndicator className="mt-1" />
                            </div>
                        )}
                        {error && (
                            <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-8 h-8 bg-red-100 rounded-md flex items-center justify-center">
                                    <i className="fa-sharp fa-solid fa-circle-exclamation text-red-600"></i>
                                </div>
                                <div className="flex-1 bg-red-50 border border-red-200 rounded-lg p-3 max-w-[85%]">
                                    <div className="text-red-800 text-sm">
                                        <strong>Error:</strong> {error.message}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </OverlayScrollbarsComponent>
            </div>
        );
    })
);
ChatWindow.displayName = "ChatWindow";

const ChatItem = memo(
    ({ message, fontSize, fixedFontSize }: { message: ChatMessage; fontSize?: string; fixedFontSize?: string }) => {
        const { role, content, reasoning } = message;

        if (role === "user") {
            return (
                <div className="flex items-start gap-3 justify-end">
                    <div className="bg-accent/15 rounded-lg p-3 max-w-[85%] ml-auto">
                        <Streamdown className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                            {content}
                        </Streamdown>
                    </div>
                    <div className="flex-shrink-0 w-8 h-8 bg-accent/10 rounded-md flex items-center justify-center">
                        <i className="fa-sharp fa-solid fa-user text-accent"></i>
                    </div>
                </div>
            );
        }

        if (role === "assistant") {
            return (
                <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-accent/10 rounded-md flex items-center justify-center">
                        <i className="fa-sharp fa-solid fa-sparkles text-accent"></i>
                    </div>
                    <div className="flex flex-col gap-2 max-w-[85%]">
                        {reasoning && (
                            <div className="bg-accent/10 border border-accent/20 rounded-lg p-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <i className="fa-sharp fa-solid fa-brain text-accent text-sm"></i>
                                    <span className="text-foreground text-sm font-medium">Reasoning</span>
                                </div>
                                <Streamdown className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                                    {reasoning}
                                </Streamdown>
                            </div>
                        )}
                        <div className="bg-secondary/10 rounded-lg p-3">
                            <Streamdown className="size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                                {content}
                            </Streamdown>
                        </div>
                    </div>
                </div>
            );
        }

        return null;
    }
);
ChatItem.displayName = "ChatItem";

const ChatInput = memo(
    ({
        input,
        handleInputChange,
        handleSubmit,
        isLoading,
        textAreaRef,
    }: {
        input: string;
        handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
        handleSubmit: (e: React.FormEvent) => void;
        isLoading: boolean;
        textAreaRef: React.RefObject<HTMLTextAreaElement>;
    }) => {
        const [textAreaHeight, setTextAreaHeight] = useState(25);
        const maxLines = 5;
        const lineHeight = 17;
        const minHeight = 25;
        const maxHeight = minHeight + (maxLines - 1) * lineHeight;

        const adjustTextAreaHeight = useCallback(() => {
            if (textAreaRef.current) {
                const textArea = textAreaRef.current;
                textArea.style.height = `${minHeight}px`;
                const scrollHeight = textArea.scrollHeight;
                const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
                setTextAreaHeight(newHeight);
                textArea.style.height = `${newHeight}px`;
            }
        }, [textAreaRef, minHeight, maxHeight]);

        useEffect(() => {
            adjustTextAreaHeight();
        }, [input, adjustTextAreaHeight]);

        const handleKeyDown = useCallback(
            (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleSubmit(event as any);
                    return;
                }
            },
            [handleSubmit]
        );

        return (
            <div className="flex-shrink-0 p-4 border-t border-border">
                <form onSubmit={handleSubmit} className="flex items-end gap-3">
                    <div className="flex-1 relative">
                        <textarea
                            ref={textAreaRef}
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask Wave AI anything..."
                            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent disabled:opacity-50"
                            style={{ height: `${textAreaHeight}px` }}
                            disabled={isLoading}
                        />
                    </div>
                    <Button
                        type="submit"
                        disabled={isLoading || !input.trim()}
                        className="solid green h-10 w-10 rounded-lg p-0 flex items-center justify-center"
                    >
                        <i className="fa-sharp fa-solid fa-paper-plane-top text-sm" />
                    </Button>
                </form>
            </div>
        );
    }
);
ChatInput.displayName = "ChatInput";

const WaveAiUseChat = ({ blockId, model }: WaveAiUseChatProps) => {
    const presetKey = useAtomValue(model.presetKey);
    const fontSize = useAtomValue(model.mergedPresets)?.["ai:fontsize"];
    const fixedFontSize = useAtomValue(model.mergedPresets)?.["ai:fixedfontsize"];
    const [initialMessages, setInitialMessages] = useState<ChatMessage[]>([]);
    const [isInitialized, setIsInitialized] = useState(false);

    // Load initial messages
    useEffect(() => {
        const loadMessages = async () => {
            try {
                const messages = await model.populateMessages();
                setInitialMessages(messages);
                setIsInitialized(true);
            } catch (error) {
                console.error("Failed to load initial messages:", error);
                setIsInitialized(true);
            }
        };
        loadMessages();
    }, [model]);

    const [input, setInput] = useState("");
    const { messages, sendMessage, status, error, setMessages, stop } = useChat({
        id: `chat-${blockId}`,
        messages: initialMessages.map((m) => ({
            id: m.id,
            role: m.role,
            parts: [{ type: "text", text: m.content }],
        })),
        transport: new DefaultChatTransport({
            api: `${getWebServerEndpoint()}/api/aichat?blockid=${blockId}&preset=${encodeURIComponent(presetKey)}`,
            body: () => ({
                blockId,
                preset: presetKey,
            }),
            headers: async () => ({
                "X-Block-ID": blockId,
            }),
            prepareSendMessagesRequest: ({ id, messages, trigger, messageId }) => ({
                headers: { "X-Session-ID": id },
                body: {
                    messages: messages.slice(-30), // Keep last 30 messages
                    trigger,
                    messageId,
                },
            }),
            credentials: "include",
        }),
        onFinish: async ({ message }) => {
            // Save conversation after each completion
            try {
                const allMessages = [...messages, message];
                const chatMessages = allMessages.map((m) => {
                    const text = m.parts?.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('') ?? '';
                    const reasoning = m.parts?.filter((p: any) => p.type === 'reasoning').map((p: any) => p.text).join('') ?? '';
                    return {
                        id: m.id,
                        role: m.role as "user" | "assistant" | "system",
                        content: text,
                        reasoning,
                    };
                });
                await model.saveMessages(chatMessages);
            } catch (error) {
                console.error("Failed to save messages:", error);
            }
        },
        onError: (error) => {
            console.error("Chat error:", error);
        },
    });

    const isLoading = status === "submitted";

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
    }, []);

    const handleSubmit = useCallback(
        (e: React.FormEvent) => {
            e.preventDefault();
            if (!input.trim() || isLoading) return;

            sendMessage({ text: input });
            setInput("");
        },
        [input, isLoading, sendMessage]
    );

    // Clear messages handler
    const handleClearMessages = useCallback(async () => {
        try {
            await model.clearMessages();
            setMessages([]);
        } catch (error) {
            console.error("Failed to clear messages:", error);
        }
    }, [model, setMessages]);

    // Update model's clear method to use our handler
    useEffect(() => {
        model.clearMessages = handleClearMessages;
    }, [model, handleClearMessages]);

    if (!isInitialized) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="text-muted-foreground">Loading...</div>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full bg-background">
            <ChatWindow
                messages={messages.map((m) => {
                    const text = m.parts
                        .filter((p: any) => p.type === 'text')
                        .map((p: any) => p.text)
                        .join('');

                    const reasoning = m.parts
                        .filter((p: any) => p.type === 'reasoning')
                        .map((p: any) => p.text)
                        .join('');

                    return {
                        id: m.id,
                        role: m.role as "user" | "assistant" | "system",
                        content: text,
                        reasoning,
                    };
                })}
                isLoading={isLoading}
                error={error}
                fontSize={fontSize}
                fixedFontSize={fixedFontSize}
            />
            <ChatInput
                input={input}
                handleInputChange={handleInputChange}
                handleSubmit={handleSubmit}
                isLoading={isLoading}
                textAreaRef={model.textAreaRef}
            />
        </div>
    );
};

export { WaveAiUseChat };
export const WaveAiUseChatModel = WaveAiUseChatModelImpl;
