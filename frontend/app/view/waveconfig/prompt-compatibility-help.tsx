// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Prompt Compatibility Help Component
 *
 * Provides documentation and guidance for configuring custom shell prompts
 * (Oh-My-Posh, Starship, Powerlevel10k) to work with Wave Terminal's theme system.
 */

import { memo } from "react";
import { ShellProfileHelper } from "./shell-profile-helper";
import "./prompt-compatibility-help.scss";

interface ExternalLink {
    title: string;
    description: string;
    url: string;
}

const EXTERNAL_LINKS: ExternalLink[] = [
    {
        title: "Oh-My-Posh",
        description: "Configure colors to use terminal palette",
        url: "https://ohmyposh.dev/docs/config-colors",
    },
    {
        title: "Starship",
        description: "Cross-shell prompt configuration guide",
        url: "https://starship.rs/config/",
    },
    {
        title: "Powerlevel10k",
        description: "Zsh theme configuration and color schemes",
        url: "https://github.com/romkatv/powerlevel10k#configuration",
    },
];

export const PromptCompatibilityHelp = memo(() => {
    const handleLinkClick = (url: string) => {
        window.open(url, "_blank", "noopener,noreferrer");
    };

    return (
        <div className="prompt-compatibility-help">
            {/* Explanation Section */}
            <div className="prompt-compat-section">
                <h3 className="prompt-compat-section-title">
                    <i className="fa fa-solid fa-info-circle" />
                    Why don't prompt colors change with my terminal theme?
                </h3>
                <div className="prompt-compat-explanation">
                    <p>
                        Custom prompt frameworks like <strong>Oh-My-Posh</strong>, <strong>Starship</strong>, and{" "}
                        <strong>Powerlevel10k</strong> define their own color schemes that don't automatically
                        update when you change Wave's terminal theme.
                    </p>
                    <p>
                        This can lead to poor contrast and readability issues. For example, a dark-colored prompt
                        may be hard to read on a dark background, or a light-colored prompt may blend into a light
                        background.
                    </p>
                    <p>
                        To fix this, you need to configure your prompt framework to use <strong>terminal colors</strong>{" "}
                        (ANSI colors 0-15) instead of hardcoded RGB colors. This allows the prompt to automatically
                        adapt to any terminal theme you select.
                    </p>
                </div>
            </div>

            {/* Documentation Links Section */}
            <div className="prompt-compat-section">
                <h3 className="prompt-compat-section-title">
                    <i className="fa fa-solid fa-book" />
                    Documentation & Resources
                </h3>
                <div className="prompt-compat-links">
                    {EXTERNAL_LINKS.map((link) => (
                        <button
                            key={link.title}
                            className="prompt-compat-link-card"
                            onClick={() => handleLinkClick(link.url)}
                            type="button"
                        >
                            <div className="prompt-compat-link-header">
                                <span className="prompt-compat-link-title">{link.title}</span>
                                <i className="fa fa-solid fa-external-link-alt" />
                            </div>
                            <p className="prompt-compat-link-description">{link.description}</p>
                        </button>
                    ))}
                </div>
            </div>

            {/* Shell Profile Helper Section */}
            <div className="prompt-compat-section prompt-compat-helper-section">
                <ShellProfileHelper />
            </div>

            {/* Additional Tips Section */}
            <div className="prompt-compat-section">
                <h3 className="prompt-compat-section-title">
                    <i className="fa fa-solid fa-lightbulb" />
                    Additional Tips
                </h3>
                <ul className="prompt-compat-tips">
                    <li>
                        <strong>Test your configuration:</strong> After applying the changes, switch between light
                        and dark themes in Wave to ensure your prompt remains readable.
                    </li>
                    <li>
                        <strong>Minimal themes work best:</strong> Consider using minimal or terminal-color-based
                        themes from your prompt framework for optimal compatibility.
                    </li>
                    <li>
                        <strong>Environment variables:</strong> The <code>WAVE_TERM_PALETTE</code> variable can be
                        used by your prompt scripts to detect when running in Wave Terminal.
                    </li>
                    <li>
                        <strong>Custom themes:</strong> If you maintain a custom theme configuration, look for color
                        settings and replace hardcoded hex colors with terminal color references (e.g.,{" "}
                        <code>terminal:blue</code> instead of <code>#0000FF</code>).
                    </li>
                </ul>
            </div>
        </div>
    );
});

PromptCompatibilityHelp.displayName = "PromptCompatibilityHelp";
