// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import type { Message } from "./data";

import "chatitem.less";

interface ChatItemProps {
    message: Message;
}

const ChatItem = ({ message }: ChatItemProps) => {
    const { text, timestamp } = message;
    return (
        <div className="chat-item">
            <div className="chat-time">{timestamp}</div>
            <div className="chat-text">{text}</div>
        </div>
    );
};

export { ChatItem };
