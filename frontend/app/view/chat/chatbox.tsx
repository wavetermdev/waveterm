// ChatBox Component
import { EmojiPalette } from "@/app/element/emojipalette";
import { Input } from "@/app/element/input";
import { InputDecoration } from "@/app/element/inputdecoration";
import React, { useRef, useState } from "react";

interface ChatBoxProps {
    onSendMessage: (message: string) => void;
}

const ChatBox: React.FC<ChatBoxProps> = ({ onSendMessage }) => {
    const [message, setMessage] = useState("");
    const anchorRef = useRef<HTMLButtonElement>(null);
    const scopeRef = useRef<HTMLDivElement>(null);

    const handleInputChange = (value: string) => {
        setMessage(value);
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter" && message.trim() !== "") {
            onSendMessage(message);
            setMessage("");
        }
    };

    return (
        <div ref={scopeRef} className="chatbox">
            <Input
                value={message}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                decoration={{
                    endDecoration: (
                        <InputDecoration>
                            <EmojiPalette scopeRef={scopeRef} className="emoji-palette" />
                        </InputDecoration>
                    ),
                }}
            />
        </div>
    );
};

export { ChatBox };
