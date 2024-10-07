// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { ChatMessage, ChatMessages } from "@/app/element/chatmessages";
import { Menu, MenuItem } from "@/app/element/menu";
import { UserStatus } from "@/app/element/userlist";

import "./chatview.less";

interface ChatViewProps {
    channels: MenuItem[];
    users: UserStatus[];
    messages: ChatMessage[];
}

const ChatView = ({ channels, users, messages }: ChatViewProps) => {
    return (
        <div className="chat-view">
            <Menu items={channels}></Menu>
            <div className="chat-section">
                <ChatMessages messages={messages}></ChatMessages>
            </div>
            <Menu items={users}></Menu>
        </div>
    );
};

export { ChatView };
