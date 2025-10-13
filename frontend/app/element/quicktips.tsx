// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MagnifyIcon } from "@/app/element/magnify";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";

const KeyCap = ({ children }: { children: React.ReactNode }) => {
    return (
        <div className="inline-block px-1.5 py-0.5 mx-0.5 font-mono text-[0.85em] text-gray-300 bg-highlightbg rounded-[4px] border border-gray-700 whitespace-nowrap">
            {children}
        </div>
    );
};

const IconBox = ({ children }: { children: React.ReactNode }) => {
    return (
        <div className="bg-highlightbg p-0.5 text-secondary text-xs rounded-[2px] mr-[5px] self-start [&_svg]:relative [&_svg]:top-[3px] [&_svg]:left-[1px] [&_svg]:h-[13px] [&_svg_#arrow1]:fill-primary [&_svg_#arrow2]:fill-primary">
            {children}
        </div>
    );
};

const KeyBinding = ({ keyDecl }: { keyDecl: string }) => {
    const parts = keyDecl.split(":");
    const elems: React.ReactNode[] = [];
    for (let part of parts) {
        if (part === "Cmd") {
            if (PLATFORM === PlatformMacOS) {
                elems.push(<KeyCap key="cmd">⌘ Cmd</KeyCap>);
            } else {
                elems.push(<KeyCap key="alt">Alt</KeyCap>);
            }
            continue;
        }
        if (part == "Ctrl") {
            elems.push(<KeyCap key="ctrl">^ Ctrl</KeyCap>);
            continue;
        }
        if (part == "Shift") {
            elems.push(<KeyCap key="shift">⇧ Shift</KeyCap>);
            continue;
        }
        if (part == "Arrows") {
            elems.push(<KeyCap key="arrows1">←</KeyCap>);
            elems.push(<KeyCap key="arrows2">→</KeyCap>);
            elems.push(<KeyCap key="arrows3">↑</KeyCap>);
            elems.push(<KeyCap key="arrows4">↓</KeyCap>);
            continue;
        }
        if (part == "Digit") {
            elems.push(<KeyCap key="digit">Number (1-9)</KeyCap>);
            continue;
        }
        elems.push(<KeyCap key={part}>{part.toUpperCase()}</KeyCap>);
    }
    return <div className="flex flex-row items-center ml-[5px] mr-[5px] self-start first:ml-0">{elems}</div>;
};

const QuickTips = () => {
    return (
        <div className="flex flex-row w-full">
            <div className="flex flex-col grow gap-[5px]">
                <div className="font-bold mb-[5px] mt-[10px] text-base first:mt-0">Header Icons</div>
                <div className="flex flex-row items-center">
                    <IconBox>
                        <MagnifyIcon enabled={false} />
                    </IconBox>
                    Magnify a Block <KeyBinding keyDecl="Cmd:m" />
                </div>
                <div className="flex flex-row items-center">
                    <IconBox>
                        <i className="fa-solid fa-sharp fa-laptop fa-fw" />
                    </IconBox>
                    Connect to a remote server
                    <KeyBinding keyDecl="Cmd:g" />
                </div>
                <div className="flex flex-row items-center">
                    <IconBox>
                        <i className="fa-solid fa-sharp fa-cog fa-fw" />
                    </IconBox>
                    Block Settings
                </div>
                <div className="flex flex-row items-center">
                    <IconBox>
                        <i className="fa-solid fa-sharp fa-xmark-large fa-fw" />
                    </IconBox>
                    Close Block <KeyBinding keyDecl="Cmd:w" />
                </div>

                <div className="font-bold mb-[5px] mt-[10px] text-base first:mt-0">Important Keybindings</div>

                <div className="flex flex-row items-center">
                    <KeyBinding keyDecl="Cmd:t" />
                    New Tab
                </div>
                <div className="flex flex-row items-center">
                    <KeyBinding keyDecl="Cmd:n" />
                    New Terminal Block
                </div>
                <div className="flex flex-row items-center">
                    <KeyBinding keyDecl="Ctrl:Shift:Arrows" />
                    Navigate Between Blocks
                </div>
                <div className="flex flex-row items-center">
                    <KeyBinding keyDecl="Ctrl:Shift:Digit" />
                    Focus Nth Block
                </div>
                <div className="flex flex-row items-center">
                    <KeyBinding keyDecl="Cmd:Digit" />
                    Switch To Nth Tab
                </div>
                <div className="flex flex-row items-center">
                    <KeyBinding keyDecl="Cmd:Shift:a" />
                    Open Wave AI Panel
                </div>
                <div className="flex flex-row items-center">
                    <KeyBinding keyDecl="Ctrl:Shift:0" />
                    Focus Wave AI
                </div>

                <div className="font-bold mb-[5px] mt-[10px] text-base first:mt-0">wsh commands</div>
                <div className="flex flex-row items-center">
                    <div>
                        <code className="px-1.5 py-0.5 bg-highlightbg">wsh view [filename|url]</code>
                        <div className="mt-[5px]">
                            Run this command in the terminal to preview a file, directory, or web URL.
                        </div>
                    </div>
                </div>

                <div className="font-bold mb-[5px] mt-[10px] text-base first:mt-0">More Tips</div>
                <div className="flex flex-row items-center">
                    <IconBox>
                        <i className="fa-solid fa-sharp fa-computer-mouse fa-fw" />
                    </IconBox>
                    Right click the tabs to change backgrounds or rename.
                </div>
                <div className="flex flex-row items-center">
                    <IconBox>
                        <i className="fa-solid fa-sharp fa-cog fa-fw" />
                    </IconBox>
                    Click the gear in the web view to set your homepage
                </div>
                <div className="flex flex-row items-center">
                    <IconBox>
                        <i className="fa-solid fa-sharp fa-cog fa-fw" />
                    </IconBox>
                    Click the gear in the terminal to set your terminal theme and font size
                </div>
                <div className="font-bold mb-[5px] mt-[10px] text-base first:mt-0">Need More Help?</div>
                <div className="flex flex-row items-center">
                    <IconBox>
                        <i className="fa-brands fa-discord fa-fw" />
                    </IconBox>
                    <div>
                        <a target="_blank" href="https://discord.gg/XfvZ334gwU" rel="noopener">
                            Join Our Discord
                        </a>
                    </div>
                </div>
                <div className="flex flex-row items-center">
                    <IconBox>
                        <i className="fa-solid fa-sharp fa-sliders fa-fw" />
                    </IconBox>
                    <div>
                        <a target="_blank" href="https://docs.waveterm.dev/config" rel="noopener">
                            Configuration Options
                        </a>
                    </div>
                </div>
                <div className="flex flex-row items-center">
                    <IconBox>
                        <i className="fa-solid fa-sharp fa-keyboard fa-fw" />
                    </IconBox>
                    <div>
                        <a target="_blank" href="https://docs.waveterm.dev/keybindings" rel="noopener">
                            All Keybindings
                        </a>
                    </div>
                </div>
                <div className="flex flex-row items-center">
                    <IconBox>
                        <i className="fa-solid fa-sharp fa-book fa-fw" />
                    </IconBox>
                    <div>
                        <a target="_blank" href="https://docs.waveterm.dev" rel="noopener">
                            Full Documentation
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
};

export { KeyBinding, QuickTips };
