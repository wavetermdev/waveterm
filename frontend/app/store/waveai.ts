// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom, useAtom } from "jotai";
import { v4 as uuidv4 } from "uuid";

interface ChatMessageType {
    id: string;
    user: string;
    text: string;
    isAssistant: boolean;
    isUpdating?: boolean;
    isError?: string;
}

const defaultMessage: ChatMessageType = {
    id: uuidv4(),
    user: "assistant",
    text: `<p>Hello, how may I help you with this command?<br>
(Cmd-Shift-Space: open/close, Ctrl+L: clear chat buffer, Up/Down: select code blocks, Enter: to copy a selected code block to the command input)</p>`,
    isAssistant: true,
};

const messagesAtom = atom<ChatMessageType[]>([defaultMessage]);

const addMessageAtom = atom(null, (get, set, message: ChatMessageType) => {
    const messages = get(messagesAtom);
    set(messagesAtom, [...messages, message]);
});

const updateLastMessageAtom = atom(null, (get, set, text: string, isUpdating: boolean) => {
    const messages = get(messagesAtom);
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.isAssistant && !lastMessage.isError) {
        const updatedMessage = { ...lastMessage, text: lastMessage.text + text, isUpdating };
        set(messagesAtom, [...messages.slice(0, -1), updatedMessage]);
    }
});

const simulateAssistantResponseAtom = atom(null, (get, set, userMessage: ChatMessageType) => {
    const responseText = `Here is an example of a simple bash script:

\`\`\`bash
#!/bin/bash
# This is a comment
echo "Hello, World!"
\`\`\`

You can run this script by saving it to a file, for example, \`hello.sh\`, and then running \`chmod +x hello.sh\` to make it executable. Finally, run it with \`./hello.sh\`.`;

    const typingMessage: ChatMessageType = {
        id: uuidv4(),
        user: "assistant",
        text: "",
        isAssistant: true,
    };

    // Add a typing indicator
    set(addMessageAtom, typingMessage);

    setTimeout(() => {
        const parts = responseText.split(" ");
        let currentPart = 0;

        const intervalId = setInterval(() => {
            if (currentPart < parts.length) {
                const part = parts[currentPart] + " ";
                set(updateLastMessageAtom, part, true);
                currentPart++;
            } else {
                clearInterval(intervalId);
                set(updateLastMessageAtom, "", false);
            }
        }, 100);
    }, 1500);
});

const useWaveAi = () => {
    const [messages] = useAtom(messagesAtom);
    const [, addMessage] = useAtom(addMessageAtom);
    const [, simulateResponse] = useAtom(simulateAssistantResponseAtom);

    const sendMessage = (text: string, user: string = "user") => {
        const newMessage: ChatMessageType = {
            id: uuidv4(),
            user,
            text,
            isAssistant: false,
        };
        addMessage(newMessage);
        simulateResponse(newMessage);
    };

    return {
        messages,
        sendMessage,
    };
};

export { useWaveAi };
export type { ChatMessageType };
