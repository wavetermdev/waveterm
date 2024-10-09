// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
import { ChatMessage, ChatMessages } from "@/app/element/chatmessages";
import { MenuItem } from "@/app/element/menu";
import { UserStatus } from "@/app/element/userlist";
import { Channels } from "./channels";
import { channels, messages, users } from "./data";
import { Users } from "./users";

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
                <ChatMessages messages={messages}></ChatMessages>
            </div>
            <Users users={users}></Users>
        </div>
    );
};

export { Chat, ChatModel, makeChatModel };
