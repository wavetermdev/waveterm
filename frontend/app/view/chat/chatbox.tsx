// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { EmojiPalette } from "@/app/element/emojipalette";
import { InputGroup } from "@/app/element/input";
import { MultiLineInput } from "@/app/element/multilineinput";
import * as keyutil from "@/util/keyutil";
import React, { useState } from "react";

interface ChatBoxProps {
    onSendMessage: (message: string) => void;
}

const ChatBox = ({ onSendMessage }: ChatBoxProps) => {
    const [message, setMessage] = useState("");

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setMessage(e.target.value);
    };

    const handleKeyDown = (waveEvent: WaveKeyboardEvent): boolean => {
        if (keyutil.checkKeyPressed(waveEvent, "Enter") && !waveEvent.shift && message.trim() !== "") {
            onSendMessage(message);
            setMessage("");
            return true;
        }
        return false;
    };

    return (
        <InputGroup className="chatbox">
            <MultiLineInput
                className="input"
                value={message}
                onChange={handleInputChange}
                onKeyDown={(e) => keyutil.keydownWrapper(handleKeyDown)(e)}
                placeholder="Type a message..."
            />
            <EmojiPalette placement="top-end" />
        </InputGroup>
    );
};

export { ChatBox };
