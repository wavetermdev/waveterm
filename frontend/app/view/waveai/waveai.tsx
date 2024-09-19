// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Markdown } from "@/app/element/markdown";
import { TypingIndicator } from "@/app/element/typingindicator";
import { useDimensions } from "@/app/hook/useDimensions";
import { RpcApi } from "@/app/store/wshclientapi";
import { WindowRpcClient } from "@/app/store/wshrpcutil";
import { atoms, fetchWaveFile, globalStore, WOS } from "@/store/global";
import { BlockService } from "@/store/services";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import { isBlank, makeIconClass } from "@/util/util";
import { atom, Atom, PrimitiveAtom, useAtomValue, useSetAtom, WritableAtom } from "jotai";
import type { OverlayScrollbars } from "overlayscrollbars";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
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
}

function promptToMsg(prompt: OpenAIPromptMessageType): ChatMessageType {
    return {
        id: crypto.randomUUID(),
        user: prompt.role,
        text: prompt.content,
        isAssistant: prompt.role == "assistant",
    };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class WaveAiModel implements ViewModel {
    viewType: string;
    blockId: string;
    blockAtom: Atom<Block>;
    viewIcon?: Atom<string | IconButtonDecl>;
    viewName?: Atom<string>;
    viewText?: Atom<string | HeaderElem[]>;
    preIconButton?: Atom<IconButtonDecl>;
    endIconButtons?: Atom<IconButtonDecl[]>;
    messagesAtom: PrimitiveAtom<Array<ChatMessageType>>;
    addMessageAtom: WritableAtom<unknown, [message: ChatMessageType], void>;
    updateLastMessageAtom: WritableAtom<unknown, [text: string, isUpdating: boolean], void>;
    removeLastMessageAtom: WritableAtom<unknown, [], void>;
    simulateAssistantResponseAtom: WritableAtom<unknown, [userMessage: ChatMessageType], Promise<void>>;
    textAreaRef: React.RefObject<HTMLTextAreaElement>;
    locked: PrimitiveAtom<boolean>;
    cancel: boolean;

    constructor(blockId: string) {
        this.locked = atom(false);
        this.cancel = false;
        this.viewType = "waveai";
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = atom((get) => {
            return "sparkles"; // should not be hardcoded
        });
        this.viewName = atom("Wave Ai");
        this.messagesAtom = atom([]);

        this.addMessageAtom = atom(null, (get, set, message: ChatMessageType) => {
            const messages = get(this.messagesAtom);
            set(this.messagesAtom, [...messages, message]);
        });

        this.updateLastMessageAtom = atom(null, (get, set, text: string, isUpdating: boolean) => {
            const messages = get(this.messagesAtom);
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.isAssistant && !lastMessage.isError) {
                const updatedMessage = { ...lastMessage, text: lastMessage.text + text, isUpdating };
                set(this.messagesAtom, [...messages.slice(0, -1), updatedMessage]);
            }
        });
        this.removeLastMessageAtom = atom(null, (get, set) => {
            const messages = get(this.messagesAtom);
            messages.pop();
            set(this.messagesAtom, [...messages]);
        });
        this.simulateAssistantResponseAtom = atom(null, async (get, set, userMessage: ChatMessageType) => {
            // unused at the moment. can replace the temp() function in the future
            const typingMessage: ChatMessageType = {
                id: crypto.randomUUID(),
                user: "assistant",
                text: "",
                isAssistant: true,
            };

            // Add a typing indicator
            set(this.addMessageAtom, typingMessage);
            await sleep(1500);
            const parts = userMessage.text.split(" ");
            let currentPart = 0;
            while (currentPart < parts.length) {
                const part = parts[currentPart] + " ";
                set(this.updateLastMessageAtom, part, true);
                currentPart++;
                await sleep(100);
            }
            set(this.updateLastMessageAtom, "", false);
        });
        this.viewText = atom((get) => {
            const settings = get(atoms.settingsAtom);
            const isCloud = isBlank(settings?.["ai:apitoken"]) && isBlank(settings?.["ai:baseurl"]);
            let modelText = "gpt-4o-mini";
            if (!isCloud && !isBlank(settings?.["ai:model"])) {
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
        const messages = useAtomValue(this.messagesAtom);
        const addMessage = useSetAtom(this.addMessageAtom);
        const simulateResponse = useSetAtom(this.simulateAssistantResponseAtom);
        const clientId = useAtomValue(atoms.clientId);
        const blockId = this.blockId;
        const setLocked = useSetAtom(this.locked);

        const sendMessage = (text: string, user: string = "user") => {
            setLocked(true);
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
            const temp = async () => {
                const typingMessage: ChatMessageType = {
                    id: crypto.randomUUID(),
                    user: "assistant",
                    text: "",
                    isAssistant: true,
                };

                // Add a typing indicator
                globalStore.set(this.addMessageAtom, typingMessage);
                const history = await this.fetchAiData();
                const beMsg: OpenAiStreamRequest = {
                    clientid: clientId,
                    opts: opts,
                    prompt: [...history, newPrompt],
                };
                const aiGen = RpcApi.StreamWaveAiCommand(WindowRpcClient, beMsg, { timeout: 60000 });
                let fullMsg = "";
                for await (const msg of aiGen) {
                    fullMsg += msg.text ?? "";
                    globalStore.set(this.updateLastMessageAtom, msg.text ?? "", true);
                    if (this.cancel) {
                        if (fullMsg == "") {
                            globalStore.set(this.removeLastMessageAtom);
                        }
                        break;
                    }
                    await sleep(100);
                }
                globalStore.set(this.updateLastMessageAtom, "", false);
                if (fullMsg != "") {
                    const responsePrompt: OpenAIPromptMessageType = {
                        role: "assistant",
                        content: fullMsg,
                    };
                    await BlockService.SaveWaveAiData(blockId, [...history, newPrompt, responsePrompt]);
                }
                setLocked(false);
                this.cancel = false;
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

const ChatItem = ({ chatItem }: ChatItemProps) => {
    const { isAssistant, text, isError } = chatItem;
    const senderClassName = isAssistant ? "chat-msg-assistant" : "chat-msg-user";
    const msgClassName = `chat-msg ${senderClassName}`;
    const cssVar = "--panel-bg-color";
    const panelBgColor = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    const color = tinycolor(panelBgColor);

    const renderError = (err: string): React.JSX.Element => <div className="chat-msg-error">{err}</div>;

    const renderContent = useMemo(() => {
        if (isAssistant) {
            if (isError) {
                return renderError(isError);
            }
            return text ? (
                <>
                    <div className="chat-msg chat-msg-header">
                        <div className="icon-box">
                            <i className="fa-sharp fa-solid fa-sparkles"></i>
                        </div>
                    </div>
                    <div
                        className="chat-msg chat-msg-assistant"
                        style={{ maxWidth: "calc(var(--aichat-msg-width) * 1px)" }}
                    >
                        <Markdown text={text} />
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
                <div className="chat-msg chat-msg-user" style={{ maxWidth: "calc(var(--aichat-msg-width) * 1px)" }}>
                    <Markdown className="msg-text" text={text} />
                </div>
            </>
        );
    }, [text, isAssistant, isError]);

    return <div className={"chat-msg-container"}>{renderContent}</div>;
};

interface ChatWindowProps {
    chatWindowRef: React.RefObject<HTMLDivElement>;
    messages: ChatMessageType[];
    msgWidths: Object;
}

const ChatWindow = memo(
    forwardRef<OverlayScrollbarsComponentRef, ChatWindowProps>(({ chatWindowRef, messages, msgWidths }, ref) => {
        const [isUserScrolling, setIsUserScrolling] = useState(false);

        const osRef = useRef<OverlayScrollbarsComponentRef>(null);
        const prevMessagesLenRef = useRef(messages.length);

        useImperativeHandle(ref, () => osRef.current as OverlayScrollbarsComponentRef);

        useEffect(() => {
            if (osRef.current && osRef.current.osInstance()) {
                const { viewport } = osRef.current.osInstance().elements();
                const curMessagesLen = messages.length;
                if (prevMessagesLenRef.current !== curMessagesLen || !isUserScrolling) {
                    setIsUserScrolling(false);
                    viewport.scrollTo({
                        behavior: "auto",
                        top: chatWindowRef.current?.scrollHeight || 0,
                    });
                }

                prevMessagesLenRef.current = curMessagesLen;
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
                className="scrollable"
                options={{ scrollbars: { autoHide: "leave" } }}
                events={{ initialized: handleScrollbarInitialized, updated: handleScrollbarUpdated }}
            >
                <div ref={chatWindowRef} className="chat-window" style={msgWidths}>
                    <div className="filler"></div>
                    {messages.map((chitem, idx) => (
                        <ChatItem key={idx} chatItem={chitem} />
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
                placeholder="Ask anything..."
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

    const [value, setValue] = useState("");
    const [selectedBlockIdx, setSelectedBlockIdx] = useState<number | null>(null);

    const termFontSize: number = 14;
    const windowDims = useDimensions(chatWindowRef);
    const msgWidths = {};
    const locked = useAtomValue(model.locked);
    msgWidths["--aichat-msg-width"] = windowDims.width * 0.85;

    // a weird workaround to initialize ansynchronously
    useEffect(() => {
        model.populateMessages();
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
    }, [messages, value]);

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
            <ChatWindow ref={osRef} chatWindowRef={chatWindowRef} messages={messages} msgWidths={msgWidths} />
            <div className="waveai-controls">
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
                <Button className={buttonClass} onClick={handleButtonPress}>
                    <i className={buttonIcon} title={buttonTitle} />
                </Button>
            </div>
        </div>
    );
};

export { makeWaveAiViewModel, WaveAi };
