// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ChatMessage, ChatMessages } from "@/app/view/chat/chatmessages";
import { UserStatus } from "@/app/view/chat/userlist";
import { Channels } from "./channels";
import { ChatBox } from "./chatbox";
import { channels, messages, users } from "./data";
import { UserList } from "./userlist";

import "./chat.less";

class ChatModel {
    viewType: string;
    channels: MenuItem[];
    users: UserStatus[];
    messages: ChatMessage[];

    constructor(blockId: string) {
        this.viewType = "chat";
        this.channels = channels;
        this.messages = messages;
        this.users = users;
    }
}

function makeChatModel(blockId: string): ChatModel {
    const cpuPlotViewModel = new ChatModel(blockId);
    return cpuPlotViewModel;
}

interface ChatProps {
    model: ChatModel;
}

const Chat = ({ model }: ChatProps) => {
    const { channels, users, messages } = model;
    return (
        <div className="chat-view">
            <Channels channels={channels}></Channels>
            <div className="chat-section">
                <div className="message-wrapper">
                    <ChatMessages messages={messages}></ChatMessages>
                </div>
                <ChatBox onSendMessage={(message: string) => console.log("message: ", message)} />
            </div>
            <UserList users={users}></UserList>
        </div>
    );
};

export { Chat, ChatModel, makeChatModel };
