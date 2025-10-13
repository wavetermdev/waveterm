// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveStreamdown } from "@/app/element/streamdown";
import { memo, useEffect, useRef, useState } from "react";

interface ChatConfig {
    userPrompt: string;
    toolName: string;
    toolDescription: string;
    markdownResponse: string;
}

const chatConfigs: ChatConfig[] = [
    {
        userPrompt: "Check out ~/waveterm and summarize the project — what it does and how it's organized.",
        toolName: "read_dir",
        toolDescription: 'reading directory "~/waveterm"',
        markdownResponse: `Here's a quick, file-structure–driven overview of this repo (Wave Terminal):

## What it is
- Electron + React front end with a Go backend ("wavesrv"). Provides a terminal with GUI widgets, previews, web, and AI. (README.md)
- Licensed Apache-2.0. (LICENSE)

## Architecture at a glance
- **Electron main process:** \`emain/*.ts\` configures windows, menus, preload scripts, updater, and ties into the Go backend via local RPC. (\`emain/\`)
- **Renderer UI:** React/TS built with Vite, Tailwind. (\`frontend/\`, \`index.html\`, \`electron.vite.config.ts\`)
- **Go backend ("wavesrv"):** starts services, web and websocket listeners, telemetry loops, config watcher, local RPC, filestore and SQLite-backed object store. (\`cmd/server/main-server.go\`, \`pkg/*\`)
- **CLI/helper ("wsh"):** built for multiple OS/arch; used for shell integration and remote operations. (\`cmd/wsh/\`, \`Taskfile.yml build:wsh\`)

## Key directories
- **cmd/:** entrypoints and generators
  - \`server/\`: wavesrv main
  - \`generategs/\`, \`generatego/\`: TS/Go bindings generation
  - \`wsh/\`: shell helper

- **pkg/:** backend packages
  - \`wcore/\`: startup coordination, initial data, window/workspace creation
  - \`web/\`: HTTP+WS servers, Unix listener
  - \`waveai/\`: AI backends (OpenAI, Anthropic, Google, Perplexity)
  - \`wshrpc\`, \`wshutil\`, \`wslconn\`, \`remote/*\`: local/remote RPC, WSL, SSH, fileshare
  - \`wstore/\`: persistent store (SQLite via sqlx); \`waveobj/\`: object model
  - \`filestore/\`: local file cache/storage
  - \`telemetry/\`: metrics/events, periodic reporting`,
    },
    {
        userPrompt: "can you analyze the log output in my terminal?",
        toolName: "term_get_scrollback",
        toolDescription: "reading terminal output from widget",
        markdownResponse: `Here's what your log shows:

- Normal startup/init at 18:06:51 (router/register, DBGetAllObjsByType, Stat/Read).
- Many FocusWindow events — normal UI activity.
- 18:08:28.558 WebSocket ReadPump error: close 1001 (going away) — usually a tab/app reload, sleep, or brief network hiccup.
- 18:08:29 re-init + new WebSocket connection — successful auto-reconnect.
- SetMetaCommand and periodic filestore flushes with err: — normal; no failures.
- No panics/fatal errors; just the transient disconnect.

If that disconnect was unexpected, check for a tab reload/sleep at 18:08:28, and watch for repeats.

Want deeper triage? Run these and paste results:

\`\`\`bash
# 1) Scan recent logs for problems
grep -Ei 'error|panic|fatal|websocket|1006|1011' \\
  "$HOME/Library/Application Support/waveterm-dev/waveapp.log" | tail -n 200

# 2) Inspect around the disconnect window
awk '($0 ~ /2025-10-10 18:08:2[0-9]/){print}' \\
  "$HOME/Library/Application Support/waveterm-dev/waveapp.log"

# 3) Live follow for recurring drops
tail -f "$HOME/Library/Application Support/waveterm-dev/waveapp.log" \\
  | grep -Ei 'error|panic|fatal|websocket|close'
\`\`\`

Need me to look at a longer slice (e.g., last 1000 lines) or a different time range?`,
    },
];

const AIThinking = memo(() => (
    <div className="flex items-center gap-2">
        <div className="animate-pulse flex items-center">
            <i className="fa fa-circle text-[10px]"></i>
            <i className="fa fa-circle text-[10px] mx-1"></i>
            <i className="fa fa-circle text-[10px]"></i>
        </div>
        <span className="text-sm text-gray-400">AI is thinking...</span>
    </div>
));

AIThinking.displayName = "AIThinking";

const FakeToolCall = memo(({ toolName, toolDescription }: { toolName: string; toolDescription: string }) => {
    return (
        <div className="flex items-start gap-1 p-2 rounded bg-gray-800 border border-gray-700 text-success">
            <span className="font-bold">✓</span>
            <div className="flex-1">
                <div className="font-semibold">{toolName}</div>
                <div className="text-sm text-gray-400">{toolDescription}</div>
            </div>
        </div>
    );
});

FakeToolCall.displayName = "FakeToolCall";

const FakeUserMessage = memo(({ userPrompt }: { userPrompt: string }) => {
    return (
        <div className="flex justify-end">
            <div className="px-2 py-2 rounded-lg bg-accent-800 text-white max-w-[calc(100%-20px)]">
                <div className="whitespace-pre-wrap break-words">{userPrompt}</div>
            </div>
        </div>
    );
});

FakeUserMessage.displayName = "FakeUserMessage";

const FakeAssistantMessage = memo(({ config, onComplete }: { config: ChatConfig; onComplete?: () => void }) => {
    const [phase, setPhase] = useState<"thinking" | "tool" | "streaming">("thinking");
    const [streamedText, setStreamedText] = useState("");

    useEffect(() => {
        const timeouts: NodeJS.Timeout[] = [];
        let streamInterval: NodeJS.Timeout | null = null;

        const runAnimation = () => {
            setPhase("thinking");
            setStreamedText("");

            timeouts.push(
                setTimeout(() => {
                    setPhase("tool");
                }, 2000)
            );

            timeouts.push(
                setTimeout(() => {
                    setPhase("streaming");
                }, 4000)
            );

            timeouts.push(
                setTimeout(() => {
                    let currentIndex = 0;
                    streamInterval = setInterval(() => {
                        if (currentIndex >= config.markdownResponse.length) {
                            if (streamInterval) {
                                clearInterval(streamInterval);
                                streamInterval = null;
                            }
                            if (onComplete) {
                                onComplete();
                            }
                            return;
                        }
                        currentIndex += 10;
                        setStreamedText(config.markdownResponse.slice(0, currentIndex));
                    }, 100);
                }, 4000)
            );
        };

        runAnimation();

        return () => {
            timeouts.forEach(clearTimeout);
            if (streamInterval) {
                clearInterval(streamInterval);
            }
        };
    }, [config.markdownResponse, onComplete]);

    return (
        <div className="flex justify-start">
            <div className="px-2 py-2 rounded-lg">
                {phase === "thinking" && <AIThinking />}
                {phase === "tool" && (
                    <>
                        <div className="mb-2">
                            <FakeToolCall toolName={config.toolName} toolDescription={config.toolDescription} />
                        </div>
                        <AIThinking />
                    </>
                )}
                {phase === "streaming" && (
                    <>
                        <div className="mb-2">
                            <FakeToolCall toolName={config.toolName} toolDescription={config.toolDescription} />
                        </div>
                        <WaveStreamdown text={streamedText} parseIncompleteMarkdown={true} className="text-gray-100" />
                    </>
                )}
            </div>
        </div>
    );
});

FakeAssistantMessage.displayName = "FakeAssistantMessage";

const FakeAIPanelHeader = memo(() => {
    return (
        <div className="py-2 pl-3 pr-1 border-b border-gray-600 flex items-center justify-between min-w-0 bg-gray-900">
            <h2 className="text-white text-sm font-semibold flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
                <i className="fa fa-sparkles text-accent"></i>
                Wave AI
            </h2>

            <div className="flex items-center flex-shrink-0 whitespace-nowrap">
                <div className="flex items-center text-sm whitespace-nowrap">
                    <span className="text-gray-300 mr-1 text-[12px]">Context</span>
                    <button
                        className="relative inline-flex h-6 w-14 items-center rounded-full transition-colors bg-accent-500"
                        title="Widget Access ON"
                    >
                        <span className="absolute inline-block h-4 w-4 transform rounded-full bg-white transition-transform translate-x-8" />
                        <span className="relative z-10 text-xs text-white transition-all ml-2.5 mr-6 text-left font-bold">
                            ON
                        </span>
                    </button>
                </div>

                <button
                    className="text-gray-400 transition-colors p-1 rounded flex-shrink-0 ml-2 focus:outline-none"
                    title="More options"
                >
                    <i className="fa fa-ellipsis-vertical"></i>
                </button>
            </div>
        </div>
    );
});

FakeAIPanelHeader.displayName = "FakeAIPanelHeader";

export const FakeChat = memo(() => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [chatIndex, setChatIndex] = useState(1);
    const config = chatConfigs[chatIndex] || chatConfigs[0];

    useEffect(() => {
        const interval = setInterval(() => {
            if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    const handleComplete = () => {
        setTimeout(() => {
            setChatIndex((prev) => (prev + 1) % chatConfigs.length);
        }, 2000);
    };

    return (
        <div className="flex flex-col w-full h-full">
            <FakeAIPanelHeader />
            <div className="flex-1 overflow-hidden">
                <div ref={scrollRef} className="flex flex-col gap-1 p-2 h-full overflow-y-auto bg-gray-900">
                    <FakeUserMessage userPrompt={config.userPrompt} />
                    <FakeAssistantMessage config={config} onComplete={handleComplete} />
                </div>
            </div>
        </div>
    );
});

FakeChat.displayName = "FakeChat";
