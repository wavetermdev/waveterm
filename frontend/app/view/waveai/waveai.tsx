// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Markdown } from "@/app/element/markdown";
import { TypingIndicator } from "@/app/element/typingindicator";
import { WOS, atoms, fetchWaveFile, getUserName, globalStore } from "@/store/global";
import * as services from "@/store/services";
import { WshServer } from "@/store/wshserver";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import * as util from "@/util/util";
import * as jotai from "jotai";
import type { OverlayScrollbars } from "overlayscrollbars";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import tinycolor from "tinycolor2";
import "./waveai.less";

interface ChatMessageType {
    id: string;
    user: string;
    text: string;
    isAssistant: boolean;
    isUpdating?: boolean;
    isError?: string;
}

const outline = "2px solid var(--accent-color)";

interface ChatItemProps {
    chatItem: ChatMessageType;
    itemCount: number;
}

function promptToMsg(prompt: OpenAIPromptMessageType): ChatMessageType {
    return {
        id: crypto.randomUUID(),
        user: prompt.role,
        text: prompt.content,
        isAssistant: prompt.role == "assistant",
    };
}

export class WaveAiModel implements ViewModel {
    viewType: string;
    blockId: string;
    blockAtom: jotai.Atom<Block>;
    viewIcon?: jotai.Atom<string | HeaderIconButton>;
    viewName?: jotai.Atom<string>;
    viewText?: jotai.Atom<string | HeaderElem[]>;
    preIconButton?: jotai.Atom<HeaderIconButton>;
    endIconButtons?: jotai.Atom<HeaderIconButton[]>;
    messagesAtom: jotai.PrimitiveAtom<Array<ChatMessageType>>;
    addMessageAtom: jotai.WritableAtom<unknown, [message: ChatMessageType], void>;
    updateLastMessageAtom: jotai.WritableAtom<unknown, [text: string, isUpdating: boolean], void>;
    simulateAssistantResponseAtom: jotai.WritableAtom<unknown, [userMessage: ChatMessageType], Promise<void>>;
    textAreaRef: React.RefObject<HTMLTextAreaElement>;

    constructor(blockId: string) {
        this.viewType = "waveai";
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = jotai.atom((get) => {
            return "sparkles"; // should not be hardcoded
        });
        this.viewName = jotai.atom("Wave Ai");
        this.messagesAtom = jotai.atom([]);

        this.addMessageAtom = jotai.atom(null, (get, set, message: ChatMessageType) => {
            const messages = get(this.messagesAtom);
            set(this.messagesAtom, [...messages, message]);
        });

        this.updateLastMessageAtom = jotai.atom(null, (get, set, text: string, isUpdating: boolean) => {
            const messages = get(this.messagesAtom);
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.isAssistant && !lastMessage.isError) {
                const updatedMessage = { ...lastMessage, text: lastMessage.text + text, isUpdating };
                set(this.messagesAtom, [...messages.slice(0, -1), updatedMessage]);
            }
        });
        this.simulateAssistantResponseAtom = jotai.atom(null, async (get, set, userMessage: ChatMessageType) => {
            const typingMessage: ChatMessageType = {
                id: crypto.randomUUID(),
                user: "assistant",
                text: "",
                isAssistant: true,
            };

            // Add a typing indicator
            set(this.addMessageAtom, typingMessage);

            setTimeout(() => {
                const parts = userMessage.text.split(" ");
                let currentPart = 0;

                const intervalId = setInterval(() => {
                    if (currentPart < parts.length) {
                        const part = parts[currentPart] + " ";
                        set(this.updateLastMessageAtom, part, true);
                        currentPart++;
                    } else {
                        clearInterval(intervalId);
                        set(this.updateLastMessageAtom, "", false);
                    }
                }, 100);
            }, 1500);
        });
        this.viewText = jotai.atom((get) => {
            const settings = get(atoms.settingsAtom);
            const isCloud = util.isBlank(settings?.["ai:apitoken"]) && util.isBlank(settings?.["ai:baseurl"]);
            let modelText = "gpt-4o-mini";
            if (!isCloud && !util.isBlank(settings?.["ai:model"])) {
                modelText = settings["ai:model"];
            }
            const viewTextChildren: HeaderElem[] = [
                {
                    elemtype: "text",
                    text: modelText,
                },
            ];
            return viewTextChildren;
        });
    }

    async populateMessages(): Promise<void> {
        const history = await this.fetchAiData();
        globalStore.set(this.messagesAtom, history.map(promptToMsg));
    }

    async fetchAiData(): Promise<Array<OpenAIPromptMessageType>> {
        const { data, fileInfo } = await fetchWaveFile(this.blockId, "aidata");
        if (!data) {
            return [];
        }
        const history: Array<OpenAIPromptMessageType> = JSON.parse(new TextDecoder().decode(data));
        return history;
    }

    giveFocus(): boolean {
        if (this?.textAreaRef?.current) {
            this.textAreaRef.current?.focus();
            return true;
        }
        return false;
    }

    useWaveAi() {
        const [messages] = jotai.useAtom(this.messagesAtom);
        const [, addMessage] = jotai.useAtom(this.addMessageAtom);
        const [, simulateResponse] = jotai.useAtom(this.simulateAssistantResponseAtom);
        const clientId = jotai.useAtomValue(atoms.clientId);
        const blockId = this.blockId;

        const sendMessage = (text: string, user: string = "user") => {
            const newMessage: ChatMessageType = {
                id: crypto.randomUUID(),
                user,
                text,
                isAssistant: false,
            };
            addMessage(newMessage);
            // send message to backend and get response
            const settings = globalStore.get(atoms.settingsAtom);
            const opts: OpenAIOptsType = {
                model: settings["ai:model"],
                apitoken: settings["ai:apitoken"],
                maxtokens: settings["ai:maxtokens"],
                timeout: settings["ai:timeoutms"] / 1000,
                baseurl: settings["ai:baseurl"],
            };
            const newPrompt: OpenAIPromptMessageType = {
                role: "user",
                content: text,
            };
            if (newPrompt.name == "*username") {
                newPrompt.name = getUserName();
            }
            let temp = async () => {
                const history = await this.fetchAiData();
                const beMsg: OpenAiStreamRequest = {
                    clientid: clientId,
                    opts: opts,
                    prompt: [...history, newPrompt],
                };
                const aiGen = WshServer.StreamWaveAiCommand(beMsg, { timeout: 60000 });
                let fullMsg = "";
                for await (const msg of aiGen) {
                    fullMsg += msg.text ?? "";
                }
                const response: ChatMessageType = {
                    id: newMessage.id,
                    user: newMessage.user,
                    text: fullMsg,
                    isAssistant: true,
                };

                const responsePrompt: OpenAIPromptMessageType = {
                    role: "assistant",
                    content: fullMsg,
                };
                const writeToHistory = services.BlockService.SaveWaveAiData(blockId, [
                    ...history,
                    newPrompt,
                    responsePrompt,
                ]);
                const typeResponse = simulateResponse(response);
                Promise.all([writeToHistory, typeResponse]);
            };
            temp();
        };

        return {
            messages,
            sendMessage,
        };
    }
}

function makeWaveAiViewModel(blockId): WaveAiModel {
    const waveAiModel = new WaveAiModel(blockId);
    return waveAiModel;
}

const ChatItem = ({ chatItem, itemCount }: ChatItemProps) => {
    const { isAssistant, text, isError } = chatItem;
    const senderClassName = isAssistant ? "chat-msg-assistant" : "chat-msg-user";
    const msgClassName = `chat-msg ${senderClassName}`;
    const cssVar = "--panel-bg-color";
    const panelBgColor = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    const color = tinycolor(panelBgColor);
    const newColor = color.isValid() ? tinycolor(panelBgColor).darken(6).toString() : "none";
    const backgroundColor = itemCount % 2 === 0 ? "none" : newColor;

    const renderError = (err: string): React.JSX.Element => <div className="chat-msg-error">{err}</div>;

    const renderContent = (): React.JSX.Element => {
        if (isAssistant) {
            if (isError) {
                return renderError(isError);
            }
            return text ? (
                <>
                    <div className="chat-msg-header">
                        <i className="fa-sharp fa-solid fa-sparkles"></i>
                    </div>
                    <Markdown text={text} />
                </>
            ) : (
                <>
                    <div className="chat-msg-header">
                        <i className="fa-sharp fa-solid fa-sparkles"></i>
                    </div>
                    <TypingIndicator className="typing-indicator" />
                </>
            );
        }
        return (
            <>
                <div className="chat-msg-header">
                    <i className="fa-sharp fa-solid fa-user"></i>
                </div>
                <Markdown className="msg-text" text={text} />
            </>
        );
    };

    return (
        <div className={msgClassName} style={{ backgroundColor }}>
            {renderContent()}
        </div>
    );
};

interface ChatWindowProps {
    chatWindowRef: React.RefObject<HTMLDivElement>;
    messages: ChatMessageType[];
}

const ChatWindow = React.memo(
    forwardRef<OverlayScrollbarsComponentRef, ChatWindowProps>(({ chatWindowRef, messages }, ref) => {
        const [isUserScrolling, setIsUserScrolling] = useState(false);

        const osRef = useRef<OverlayScrollbarsComponentRef>(null);
        const prevMessagesRef = useRef<ChatMessageType[]>(messages);

        useImperativeHandle(ref, () => osRef.current as OverlayScrollbarsComponentRef);

        useEffect(() => {
            const prevMessages = prevMessagesRef.current;
            if (osRef.current && osRef.current.osInstance()) {
                const { viewport } = osRef.current.osInstance().elements();

                if (prevMessages.length !== messages.length || !isUserScrolling) {
                    setIsUserScrolling(false);
                    viewport.scrollTo({
                        behavior: "auto",
                        top: chatWindowRef.current?.scrollHeight || 0,
                    });
                }

                prevMessagesRef.current = messages;
            }
        }, [messages, isUserScrolling]);

        useEffect(() => {
            if (osRef.current && osRef.current.osInstance()) {
                const { viewport } = osRef.current.osInstance().elements();

                const handleUserScroll = () => {
                    setIsUserScrolling(true);
                };

                viewport.addEventListener("wheel", handleUserScroll, { passive: true });
                viewport.addEventListener("touchmove", handleUserScroll, { passive: true });

                return () => {
                    viewport.removeEventListener("wheel", handleUserScroll);
                    viewport.removeEventListener("touchmove", handleUserScroll);
                };
            }
        }, []);

        useEffect(() => {
            return () => {
                if (osRef.current && osRef.current.osInstance()) {
                    osRef.current.osInstance().destroy();
                }
            };
        }, []);

        const handleScrollbarInitialized = (instance: OverlayScrollbars) => {
            const { viewport } = instance.elements();
            viewport.scrollTo({
                behavior: "auto",
                top: chatWindowRef.current?.scrollHeight || 0,
            });
        };

        return (
            <OverlayScrollbarsComponent
                ref={osRef}
                className="scrollable"
                options={{ scrollbars: { autoHide: "leave" } }}
                events={{ initialized: handleScrollbarInitialized }}
            >
                <div ref={chatWindowRef} className="chat-window">
                    <div className="filler"></div>
                    {messages.map((chitem, idx) => (
                        <ChatItem key={idx} chatItem={chitem} itemCount={idx + 1} />
                    ))}
                </div>
            </OverlayScrollbarsComponent>
        );
    })
);

interface ChatInputProps {
    value: string;
    termFontSize: number;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onMouseDown: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
    model: WaveAiModel;
}

const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
    ({ value, onChange, onKeyDown, onMouseDown, termFontSize, model }, ref) => {
        const textAreaRef = useRef<HTMLTextAreaElement>(null);

        useImperativeHandle(ref, () => textAreaRef.current as HTMLTextAreaElement);

        useEffect(() => {
            model.textAreaRef = textAreaRef;
        }, []);

        const adjustTextAreaHeight = () => {
            if (textAreaRef.current == null) {
                return;
            }
            // Adjust the height of the textarea to fit the text
            const textAreaMaxLines = 100;
            const textAreaLineHeight = termFontSize * 1.5;
            const textAreaMinHeight = textAreaLineHeight;
            const textAreaMaxHeight = textAreaLineHeight * textAreaMaxLines;

            textAreaRef.current.style.height = "1px";
            const scrollHeight = textAreaRef.current.scrollHeight;
            const newHeight = Math.min(Math.max(scrollHeight, textAreaMinHeight), textAreaMaxHeight);
            textAreaRef.current.style.height = newHeight + "px";
        };

        useEffect(() => {
            adjustTextAreaHeight();
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
                style={{ fontSize: termFontSize }}
                placeholder="Send a Message..."
                value={value}
            ></textarea>
        );
    }
);

const WaveAi = ({ model }: { model: WaveAiModel; blockId: string }) => {
    const { messages, sendMessage } = model.useWaveAi();
    const waveaiRef = useRef<HTMLDivElement>(null);
    const chatWindowRef = useRef<HTMLDivElement>(null);
    const osRef = useRef<OverlayScrollbarsComponentRef>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const submitTimeoutRef = useRef<NodeJS.Timeout>(null);

    const [value, setValue] = useState("");
    const [selectedBlockIdx, setSelectedBlockIdx] = useState<number | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const termFontSize: number = 14;

    // a weird workaround to initialize ansynchronously
    useEffect(() => {
        model.populateMessages();
    }, []);

    useEffect(() => {
        return () => {
            if (submitTimeoutRef.current) {
                clearTimeout(submitTimeoutRef.current);
            }
        };
    }, []);

    const submit = useCallback(
        (messageStr: string) => {
            if (!isSubmitting) {
                setIsSubmitting(true);
                sendMessage(messageStr);

                clearTimeout(submitTimeoutRef.current);
                submitTimeoutRef.current = setTimeout(() => {
                    setIsSubmitting(false);
                }, 500);
            }
        },
        [isSubmitting, sendMessage, setValue]
    );

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
        const isCurrentlyUpdating = messages.some((message) => message.isUpdating);
        if (isCurrentlyUpdating || value === "") return;

        submit(value);
        setValue("");
        setSelectedBlockIdx(null);
    }, [messages, value]);

    const handleContainerClick = (event: React.MouseEvent<HTMLDivElement>) => {
        inputRef.current?.focus();

        const target = event.target as HTMLElement;
        if (
            target.closest(".copy-button") ||
            target.closest(".fa-square-terminal") ||
            target.closest(".waveai-input")
        ) {
            return;
        }

        const pre = target.closest("pre");
        updatePreTagOutline(pre);
    };

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

    return (
        <div ref={waveaiRef} className="waveai" onClick={handleContainerClick}>
            <ChatWindow ref={osRef} chatWindowRef={chatWindowRef} messages={messages} />
            <div className="waveai-input-wrapper">
                <ChatInput
                    ref={inputRef}
                    value={value}
                    model={model}
                    onChange={handleTextAreaChange}
                    onKeyDown={handleTextAreaKeyDown}
                    onMouseDown={handleTextAreaMouseDown}
                    termFontSize={termFontSize}
                />
            </div>
        </div>
    );
};

export { WaveAi, makeWaveAiViewModel };
