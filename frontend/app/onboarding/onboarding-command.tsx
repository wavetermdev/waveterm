// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { FakeBlock } from "./onboarding-layout";
import waveLogo from "/logos/wave-logo.png";

export type CommandRevealProps = {
    command: string;
    typeIntervalMs?: number;
    onComplete?: () => void;
    showCursor?: boolean;
};

export const CommandReveal = ({
    command,
    typeIntervalMs = 100,
    onComplete,
    showCursor: showCursorProp = true,
}: CommandRevealProps) => {
    const [displayedText, setDisplayedText] = useState("");
    const [showCursor, setShowCursor] = useState(true);
    const [isComplete, setIsComplete] = useState(false);

    useLayoutEffect(() => {
        let charIndex = 0;
        const typeInterval = setInterval(() => {
            if (charIndex < command.length) {
                setDisplayedText(command.slice(0, charIndex + 1));
                charIndex++;
            } else {
                clearInterval(typeInterval);
                setIsComplete(true);
                setShowCursor(false);
                if (onComplete) {
                    onComplete();
                }
            }
        }, typeIntervalMs);

        const cursorInterval = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        return () => {
            clearInterval(typeInterval);
            clearInterval(cursorInterval);
        };
    }, [command, typeIntervalMs, onComplete]);

    return (
        <div className="flex items-center gap-2 font-mono text-sm">
            <span className="text-accent">&gt;</span>
            <span className="text-foreground/80">
                {displayedText}
                {showCursorProp && !isComplete && showCursor && (
                    <span className="inline-block w-2 h-4 bg-foreground/80 ml-0.5 align-middle"></span>
                )}
            </span>
        </div>
    );
};

export type FakeCommandProps = {
    command: string;
    typeIntervalMs?: number;
    onComplete?: () => void;
    children: React.ReactNode;
};

export const FakeCommand = ({ command, typeIntervalMs = 100, onComplete, children }: FakeCommandProps) => {
    const [commandComplete, setCommandComplete] = useState(false);

    const handleCommandComplete = useCallback(() => {
        setCommandComplete(true);
        if (onComplete) {
            onComplete();
        }
    }, [onComplete]);

    return (
        <div className="w-full h-[400px] bg-background rounded border border-border/50 p-4 flex flex-col gap-4">
            <CommandReveal command={command} onComplete={handleCommandComplete} typeIntervalMs={typeIntervalMs} />
            {commandComplete && <div className="flex-1 min-h-0">{children}</div>}
        </div>
    );
};

export const ViewShortcutsCommand = ({ isMac, onComplete }: { isMac: boolean; onComplete?: () => void }) => {
    const modKey = isMac ? "⌘ Cmd" : "Alt";
    const markdown = `### Keyboard Shortcuts

**Switch Tabs**
Press ${modKey} + Number (1-9) to quickly switch between tabs.

**Navigate Blocks**
Use Ctrl-Shift + Arrow Keys (←→↑↓) to move between blocks in the current tab.

Use Ctrl-Shift + Number (1-9) to focus a specific block by its position.`;

    return (
        <FakeCommand command="wsh view keyboard-shortcuts.md" onComplete={onComplete}>
            <FakeBlock icon="file-lines" name="keyboard-shortcuts.md" markdown={markdown} />
        </FakeCommand>
    );
};

export const ViewLogoCommand = ({ onComplete }: { onComplete?: () => void }) => {
    return (
        <FakeCommand command="wsh view public/wave-logo.png" onComplete={onComplete}>
            <FakeBlock icon="image" name="wave-logo.png" imgsrc={waveLogo} />
        </FakeCommand>
    );
};

export const EditBashrcCommand = ({ onComplete }: { onComplete?: () => void }) => {
    const fileNameRef = useRef(`${crypto.randomUUID()}/.bashrc`);
    const bashrcContent = `# Aliases
alias ll="ls -lah"
alias gst="git status"
alias wave="wsh"

# Custom prompt
PS1="\\[\\e[32m\\]\\u@\\h\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]\\$ "

# PATH
export PATH="$HOME/.local/bin:$PATH"`;

    return (
        <FakeCommand command="wsh edit ~/.bashrc" onComplete={onComplete}>
            <FakeBlock
                icon="file-lines"
                name=".bashrc"
                editorText={bashrcContent}
                editorFileName={fileNameRef.current}
                editorLanguage="shell"
            />
        </FakeCommand>
    );
};
