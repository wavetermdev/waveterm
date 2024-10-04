// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { Avatar } from "@/app/element/avatar"
import { List } from "@/app/element/menu"
import { ChatItem } from "./chatitem"
import type { MessageListItem, UserListItem } from "./data"

import "./Layout.css";

interface ChatViewProps {
    channels: ListItem[];
    users: UserListItem[];
    messages: MessageListItem[];
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
                <List items={messages} renderItem={(props) => <ChatItem {...props} />}></List>
            </div>
        </div>
    );
};

export { ChatView };
