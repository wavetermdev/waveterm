// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MagnifyIcon } from "@/app/element/magnify";
import { PLATFORM } from "@/app/store/global";
import "./quicktips.scss";

const KeyBinding = ({ keyDecl }: { keyDecl: string }) => {
    const parts = keyDecl.split(":");
    const elems: React.ReactNode[] = [];
    for (let part of parts) {
        if (part === "Cmd") {
            if (PLATFORM === "darwin") {
                elems.push(
                    <div key="cmd" className="keybinding">
                        ⌘ Cmd
                    </div>
                );
            } else {
                elems.push(
                    <div key="alt" className="keybinding">
                        Alt
                    </div>
                );
            }
            continue;
        }
        if (part == "Ctrl") {
            elems.push(
                <div key="ctrl" className="keybinding">
                    ^ Ctrl
                </div>
            );
            continue;
        }
        if (part == "Shift") {
            elems.push(
                <div key="shift" className="keybinding">
                    ⇧ Shift
                </div>
            );
            continue;
        }
        if (part == "Arrows") {
            elems.push(
                <div key="arrows1" className="keybinding">
                    ←
                </div>
            );
            elems.push(
                <div key="arrows2" className="keybinding">
                    →
                </div>
            );
            elems.push(
                <div key="arrows3" className="keybinding">
                    ↑
                </div>
            );
            elems.push(
                <div key="arrows4" className="keybinding">
                    ↓
                </div>
            );
            continue;
        }
        if (part == "Digit") {
            elems.push(
                <div key="digit" className="keybinding">
                    Number (1-9)
                </div>
            );
            continue;
        }
        elems.push(
            <div key={part} className="keybinding">
                {part.toUpperCase()}
            </div>
        );
    }
    return <div className="keybinding-group">{elems}</div>;
};

const QuickTips = () => {
    return (
        <div className="tips-wrapper">
            <div className="tips-section">
                <div className="tip-section-header">Header Icons</div>
                <div className="tip">
                    <div className="icon-wrap">
                        <i className="fa-solid fa-sharp fa-laptop fa-fw" />
                    </div>
                    Connect to a remote server
                    <KeyBinding keyDecl="Cmd:g" />
                </div>
                <div className="tip">
                    <div className="icon-wrap">
                        <MagnifyIcon enabled={false} />
                    </div>
                    Magnify a Block <KeyBinding keyDecl="Cmd:m" />
                </div>
                <div className="tip">
                    <div className="icon-wrap">
                        <i className="fa-solid fa-sharp fa-cog fa-fw" />
                    </div>
                    Block Settings
                </div>
                <div className="tip">
                    <div className="icon-wrap">
                        <i className="fa-solid fa-sharp fa-xmark-large fa-fw" />
                    </div>
                    Close Block <KeyBinding keyDecl="Cmd:w" />
                </div>

                <div className="tip-section-header">Important Keybindings</div>

                <div className="tip">
                    <KeyBinding keyDecl="Cmd:t" />
                    New Tab
                </div>
                <div className="tip">
                    <KeyBinding keyDecl="Cmd:n" />
                    New Terminal Block
                </div>
                <div className="tip">
                    <KeyBinding keyDecl="Ctrl:Shift:Arrows" />
                    Navigate Between Blocks
                </div>
                <div className="tip">
                    <KeyBinding keyDecl="Ctrl:Shift:Digit" />
                    Focus Nth Block
                </div>
                <div className="tip">
                    <KeyBinding keyDecl="Cmd:Digit" />
                    Switch To Nth Tab
                </div>

                <div className="tip-section-header">wsh commands</div>
                <div className="tip">
                    <div>
                        <code>wsh view [filename|url]</code>
                        <div style={{ marginTop: 5 }}>
                            Run this command in the terminal to preview a file, directory, or web URL.
                        </div>
                    </div>
                </div>

                <div className="tip-section-header">More Tips</div>
                <div className="tip">
                    <div className="icon-wrap">
                        <i className="fa-solid fa-sharp fa-computer-mouse fa-fw" />
                    </div>
                    Right click the tabs to change backgrounds or rename.
                </div>
                <div className="tip">
                    <div className="icon-wrap">
                        <i className="fa-solid fa-sharp fa-cog fa-fw" />
                    </div>
                    Click the gear in the web view to set your homepage
                </div>
                <div className="tip">
                    <div className="icon-wrap">
                        <i className="fa-solid fa-sharp fa-cog fa-fw" />
                    </div>
                    Click the gear in the terminal to set your terminal theme and font size
                </div>
                <div className="tip-section-header">Need More Help?</div>
                <div className="tip">
                    <div className="icon-wrap">
                        <i className="fa-brands fa-discord fa-fw" />
                    </div>
                    <div>
                        <a target="_blank" href="https://discord.gg/XfvZ334gwU" rel="noopener">
                            Join Our Discord
                        </a>
                    </div>
                </div>
                <div className="tip">
                    <div className="icon-wrap">
                        <i className="fa-solid fa-sharp fa-sliders fa-fw" />
                    </div>
                    <div>
                        <a target="_blank" href="https://docs.waveterm.dev/config" rel="noopener">
                            Configuration Options
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
};

export { KeyBinding, QuickTips };
