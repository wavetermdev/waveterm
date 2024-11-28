// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ChatMessage, ChatMessages } from "@/app/view/chat/chatmessages";
import { UserStatus } from "@/app/view/chat/userlist";
import * as jotai from "jotai";
import { memo } from "react";
import { Channels } from "./channels";
import { ChatBox } from "./chatbox";
import { channels, messages, users } from "./data";
import { UserList } from "./userlist";

import "./chat.scss";

class ChatModel {
    viewType: string;
    channels: MenuItem[];
    users: UserStatus[];
    messagesAtom: jotai.PrimitiveAtom<ChatMessage[]>;

    constructor(blockId: string) {
        this.viewType = "chat";
        this.channels = channels;
        this.users = users;
        this.messagesAtom = jotai.atom(messages);
    }

    addMessageAtom = jotai.atom(null, (get, set, newMessage: ChatMessage) => {
        const currentMessages = get(this.messagesAtom);
        set(this.messagesAtom, [...currentMessages, newMessage]);
    });
}

function makeChatModel(blockId: string): ChatModel {
    return new ChatModel(blockId);
}

interface ChatProps {
    model: ChatModel;
}

const Chat = memo(({ model }: ChatProps) => {
    const { channels, users } = model;
    const messages = jotai.useAtomValue(model.messagesAtom);
    const [, appendMessage] = jotai.useAtom(model.addMessageAtom);

    const handleSendMessage = (message: string) => {
        const newMessage: ChatMessage = {
            id: `${Date.now()}`,
            username: "currentUser",
            message: message,
        };
        appendMessage(newMessage);
    };

    return (
        <div className="chat-view">
            <Channels channels={channels}></Channels>
            <div className="chat-section">
                <div className="message-wrapper">
                    <ChatMessages messages={messages}></ChatMessages>
                </div>
                <ChatBox onSendMessage={(message: string) => handleSendMessage(message)} />
            </div>
            <UserList users={users}></UserList>
        </div>
    );
});

export { Chat, ChatModel, makeChatModel };
