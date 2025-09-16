// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";
import { cn } from "@/util/util";
import { memo, useCallback, useEffect, useRef, useState } from "react";

interface Message {
    id: string;
    role: "user" | "assistant";
    content: string;
}

interface AIPanelProps {
    className?: string;
    onClose?: () => void;
}

const AIPanelComponent = memo(({ className, onClose }: AIPanelProps) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const scrollToBottom = () => {
        const container = messagesContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setInput(e.target.value);
    }, []);

    const handleSubmit = useCallback(
        async (e: React.FormEvent) => {
            e.preventDefault();
            if (!input.trim() || isLoading) return;

            const userMessage: Message = {
                id: Date.now().toString(),
                role: "user",
                content: input.trim(),
            };

            const newMessages = [...messages, userMessage];
            setMessages(newMessages);
            setInput("");
            setIsLoading(true);

            try {
                const response = await fetch(`${getWebServerEndpoint()}/api/aichat?blockid=ai-panel`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        messages: newMessages.map((msg) => ({
                            role: msg.role,
                            content: msg.content,
                        })),
                    }),
                });

                if (!response.ok) {
                    let errorMessage = `HTTP ${response.status}`;
                    try {
                        const errorText = await response.text();
                        if (errorText) {
                            // Truncate to max 200 chars and 2 lines
                            const truncated = errorText.substring(0, 200);
                            const lines = truncated.split('\n').slice(0, 2);
                            errorMessage = lines.join('\n');
                        }
                    } catch (e) {
                        // Fall back to status text if we can't read the response body
                        if (response.statusText) {
                            errorMessage += ` ${response.statusText}`;
                        }
                    }
                    const error = new Error(errorMessage);
                    (error as any).status = response.status;
                    throw error;
                }

                const reader = response.body?.getReader();
                if (!reader) {
                    throw new Error("No response body");
                }

                const assistantMessage: Message = {
                    id: (Date.now() + 1).toString(),
                    role: "assistant",
                    content: "",
                };

                setMessages((prev) => [...prev, assistantMessage]);

                const decoder = new TextDecoder();
                let done = false;

                while (!done) {
                    const { value, done: streamDone } = await reader.read();
                    done = streamDone;

                    if (value) {
                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split("\n");

                        for (const line of lines) {
                            if (line.startsWith("data: ")) {
                                const data = line.slice(6);
                                if (data === "[DONE]") {
                                    done = true;
                                    break;
                                }
                                try {
                                    const parsed = JSON.parse(data);
                                    if (parsed.choices?.[0]?.delta?.content) {
                                        setMessages((prev) => {
                                            const newMessages = [...prev];
                                            const lastMessage = newMessages[newMessages.length - 1];
                                            if (lastMessage && lastMessage.role === "assistant") {
                                                lastMessage.content += parsed.choices[0].delta.content;
                                            }
                                            return newMessages;
                                        });
                                    }
                                } catch (parseError) {
                                    console.error("Error parsing SSE data:", parseError);
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                console.error("Error sending message:", error);
                let errorMessage = "Sorry, I encountered an error. Please try again.";

                if (error instanceof Error) {
                    if (error.message.includes("Failed to fetch")) {
                        errorMessage = "Connection error. Check your internet connection and try again.";
                    } else {
                        // For dev tool, show the actual error message but truncated
                        const truncated = error.message.substring(0, 200);
                        const lines = truncated.split('\n').slice(0, 2);
                        errorMessage = lines.join('\n');
                    }
                }

                setMessages((prev) => [
                    ...prev,
                    {
                        id: (Date.now() + 1).toString(),
                        role: "assistant",
                        content: errorMessage,
                    },
                ]);
            } finally {
                setIsLoading(false);
            }
        },
        [input, isLoading, messages]
    );

    return (
        <div
            className={cn("bg-gray-800 border-t border-gray-600 flex flex-col", className)}
            style={{
                borderRight: "1px solid rgb(75, 85, 99)",
                borderTopRightRadius: "var(--block-border-radius)",
                borderBottomRightRadius: "var(--block-border-radius)",
            }}
        >
            <div className="p-4 border-b border-gray-600 flex items-center justify-between">
                <h2 className="text-white text-lg font-semibold flex items-center gap-2">
                    <i className="fa fa-sparkles text-accent"></i>
                    Wave AI
                </h2>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white cursor-pointer transition-colors p-1 rounded"
                        title="Close AI Panel"
                    >
                        <i className="fa fa-xmark"></i>
                    </button>
                )}
            </div>

            <div className="flex-1 flex flex-col min-h-0">
                <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.length === 0 ? (
                        <div className="text-gray-400 text-center py-8">
                            <i className="fa fa-sparkles text-4xl text-accent mb-4 block"></i>
                            <p className="text-lg">Welcome to Wave AI</p>
                            <p className="text-sm mt-2">Start a conversation by typing a message below.</p>
                        </div>
                    ) : (
                        messages.map((message) => (
                            <div
                                key={message.id}
                                className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
                            >
                                <div
                                    className={cn(
                                        "max-w-[80%] px-4 py-2 rounded-lg",
                                        message.role === "user" ? "bg-accent text-white" : "bg-gray-700 text-gray-100"
                                    )}
                                >
                                    <div className="whitespace-pre-wrap break-words">{message.content}</div>
                                </div>
                            </div>
                        ))
                    )}

                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="bg-gray-700 text-gray-100 px-4 py-2 rounded-lg">
                                <div className="flex items-center gap-2">
                                    <div className="animate-pulse">
                                        <i className="fa fa-circle text-xs"></i>
                                        <i className="fa fa-circle text-xs mx-1"></i>
                                        <i className="fa fa-circle text-xs"></i>
                                    </div>
                                    <span className="text-sm text-gray-400">AI is thinking...</span>
                                </div>
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                <div className="border-t border-gray-600 p-4">
                    <form onSubmit={handleSubmit} className="flex gap-2">
                        <input
                            value={input}
                            onChange={handleInputChange}
                            placeholder="Ask Wave AI anything..."
                            className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-accent focus:outline-none"
                            disabled={isLoading}
                        />
                        <button
                            type="submit"
                            disabled={isLoading || !input.trim()}
                            className={cn(
                                "px-4 py-2 rounded-lg cursor-pointer transition-colors",
                                isLoading || !input.trim()
                                    ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                                    : "bg-accent text-white hover:bg-accent/80"
                            )}
                        >
                            {isLoading ? (
                                <i className="fa fa-spinner fa-spin"></i>
                            ) : (
                                <i className="fa fa-paper-plane"></i>
                            )}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
});

AIPanelComponent.displayName = "AIPanel";

export { AIPanelComponent as AIPanel };
