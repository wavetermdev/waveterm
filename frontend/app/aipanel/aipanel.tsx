// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";
import { cn } from "@/util/util";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { memo, useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";

interface AIPanelProps {
    className?: string;
    onClose?: () => void;
}

const AIPanelComponent = memo(({ className, onClose }: AIPanelProps) => {
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const [input, setInput] = useState("");

    const { messages, sendMessage, status } = useChat({
        transport: new DefaultChatTransport({
            api: `${getWebServerEndpoint()}/api/aichat?waveai=1`,
        }),
        onError: (error) => {
            console.error("AI Chat error:", error);
        },
    });

    const scrollToBottom = () => {
        const container = messagesContainerRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || status !== "ready") return;

        sendMessage({ text: input.trim() });
        setInput("");
    };

    const getMessageContent = (message: any) => {
        if (message.content) return message.content;
        if (message.parts) {
            return message.parts
                .filter((part: any) => part.type === "text")
                .map((part: any) => part.text)
                .join("");
        }
        return "";
    };

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
                                    {message.role === "user" ? (
                                        <div className="whitespace-pre-wrap break-words">
                                            {getMessageContent(message)}
                                        </div>
                                    ) : (
                                        <Streamdown
                                            parseIncompleteMarkdown={status === "streaming"}
                                            className="markdown-content text-gray-100"
                                            shikiTheme={["github-dark", "github-dark"]}
                                            controls={{
                                                code: true,
                                                table: true,
                                                mermaid: true,
                                            }}
                                            mermaidConfig={{
                                                theme: "dark",
                                                darkMode: true,
                                            }}
                                            allowedLinkPrefixes={["https://", "http://", "#"]}
                                            allowedImagePrefixes={["https://", "http://", "data:"]}
                                            defaultOrigin="http://localhost"
                                        >
                                            {getMessageContent(message)}
                                        </Streamdown>
                                    )}
                                </div>
                            </div>
                        ))
                    )}

                    {status === "streaming" && (
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
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Ask Wave AI anything..."
                            className="flex-1 bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:border-accent focus:outline-none"
                            disabled={status !== "ready"}
                        />
                        <button
                            type="submit"
                            disabled={status !== "ready" || !input.trim()}
                            className={cn(
                                "px-4 py-2 rounded-lg cursor-pointer transition-colors",
                                status !== "ready" || !input.trim()
                                    ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                                    : "bg-accent text-white hover:bg-accent/80"
                            )}
                        >
                            {status === "streaming" ? (
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
