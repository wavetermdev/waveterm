// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { EmojiPalette, type EmojiItem } from "@/app/element/emojipalette";
import { InputGroup } from "@/app/element/input";
import { MultiLineInput } from "@/app/element/multilineinput";
import * as keyutil from "@/util/keyutil";
import React, { memo, useRef, useState } from "react";
import { throttle } from "throttle-debounce";

interface ChatBoxProps {
    onSendMessage: (message: string) => void;
}

const ChatBox = memo(({ onSendMessage }: ChatBoxProps) => {
    const [message, setMessage] = useState("");
    const multiLineInputRef = useRef<HTMLTextAreaElement>(null);

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

    const handleEmojiSelect = (emojiItem: EmojiItem) => {
        if (multiLineInputRef.current) {
            const { selectionStart, selectionEnd } = multiLineInputRef.current;
            const currentValue = multiLineInputRef.current.value;

            // Insert emoji at the current cursor position
            const newValue =
                currentValue.substring(0, selectionStart) + emojiItem.emoji + currentValue.substring(selectionEnd);

            // Update the message state and textarea value
            setMessage(newValue);

            // Set the textarea value manually
            multiLineInputRef.current.value = newValue;

            // Move cursor after the inserted emoji
            const cursorPosition = selectionStart + emojiItem.emoji.length;

            // Use setTimeout to ensure the cursor positioning happens after rendering the new value
            throttle(0, () => {
                if (multiLineInputRef.current) {
                    multiLineInputRef.current.selectionStart = multiLineInputRef.current.selectionEnd = cursorPosition;
                    multiLineInputRef.current.focus(); // Make sure the textarea remains focused
                }
            })();

            // Trigger onChange manually
            multiLineInputRef.current.dispatchEvent(new Event("change", { bubbles: true }));
        }
    };

    return (
        <InputGroup className="chatbox">
            <MultiLineInput
                ref={multiLineInputRef}
                className="input"
                value={message}
                onChange={handleInputChange}
                onKeyDown={(e) => keyutil.keydownWrapper(handleKeyDown)(e)}
                placeholder="Type a message..."
            />
            <EmojiPalette placement="top-end" onSelect={handleEmojiSelect} />
        </InputGroup>
    );
});

export { ChatBox };
