// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { Avatar } from "@/app/element/avatar"
import { List } from "@/app/element/list"
import { ChatItem } from "./chatitem"
import type { Channel, Message, User } from "./data"

import "./Layout.css";

interface ChatViewProps {
    channels: Channel[];
    users: User[];
    messages: Message[];
}

const ChatView = ({ channels, users, messages }: ChatViewProps) => {
	const renderChatItem = 

    return (
        <div className="chat-view">
            {columns.map((column, index) => (
                <div
                    key={index}
                    className="layout-column"
                    style={{
                        flexBasis: column.width === "fluid" ? "auto" : `${column.width}px`,
                        flexGrow: column.width === "fluid" ? 1 : 0,
                        flexShrink: column.width === "fluid" ? 1 : 0,
                    }}
                >
                    {column.content}
                </div>
            ))}
            <List items={channels}></List>
            <div className="chat-section">
                <List items={messages} renderItem={<ChatItem />}></List>
            </div>
        </div>
    );
};

export { ChatView };
