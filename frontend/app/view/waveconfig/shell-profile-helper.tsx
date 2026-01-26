// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Shell Profile Helper Component
 *
 * Generates shell-specific configuration snippets to help users configure
 * their custom prompts (Oh-My-Posh, Starship, Powerlevel10k) to use
 * terminal colors instead of hardcoded colors.
 */

import { getApi } from "@/app/store/global";
import { memo, useCallback, useMemo, useState } from "react";
import "./shell-profile-helper.scss";

type ShellType = "powershell" | "bash" | "zsh" | "fish";

interface ShellConfig {
    name: string;
    fileLocation: string;
    fileLocationInstructions: string[];
    snippet: string;
}

const SHELL_CONFIGS: Record<ShellType, ShellConfig> = {
    powershell: {
        name: "PowerShell",
        fileLocation: "$PROFILE",
        fileLocationInstructions: [
            "Open PowerShell",
            "Type: notepad $PROFILE",
            "If the file doesn't exist, it will be created",
            "Paste the configuration above",
            "Save and restart your terminal",
        ],
        snippet: `# Configure Oh-My-Posh to use Wave Terminal colors
$env:WAVE_TERM_PALETTE = $true

# For Oh-My-Posh, use a theme configured with terminal colors:
# oh-my-posh init pwsh --config "$env:POSH_THEMES_PATH/minimal.omp.json" | Invoke-Expression

# Or configure your existing theme to use terminal colors
# See: https://ohmyposh.dev/docs/config-colors`,
    },
    bash: {
        name: "Bash",
        fileLocation: "~/.bashrc (Linux) or ~/.bash_profile (macOS)",
        fileLocationInstructions: [
            "Open your terminal",
            "Edit ~/.bashrc (Linux) or ~/.bash_profile (macOS)",
            "Paste the configuration above",
            "Save the file",
            "Reload: source ~/.bashrc (or source ~/.bash_profile)",
        ],
        snippet: `# Configure shell prompt to use terminal colors
export WAVE_TERM_PALETTE=1

# For Oh-My-Posh:
# eval "$(oh-my-posh init bash --config ~/.config/omp/minimal.json)"
# See: https://ohmyposh.dev/docs/config-colors

# For Starship:
# eval "$(starship init bash)"
# Ensure your starship.toml uses terminal colors
# See: https://starship.rs/config/`,
    },
    zsh: {
        name: "Zsh",
        fileLocation: "~/.zshrc",
        fileLocationInstructions: [
            "Open your terminal",
            "Edit ~/.zshrc",
            "Paste the configuration above",
            "Save the file",
            "Reload: source ~/.zshrc",
        ],
        snippet: `# Configure shell prompt to use terminal colors
export WAVE_TERM_PALETTE=1

# For Oh-My-Posh:
# eval "$(oh-my-posh init zsh --config ~/.config/omp/minimal.json)"
# See: https://ohmyposh.dev/docs/config-colors

# For Starship:
# eval "$(starship init zsh)"
# Ensure your starship.toml uses terminal colors
# See: https://starship.rs/config/

# For Powerlevel10k:
# Use terminal colors by setting in your .p10k.zsh:
# typeset -g POWERLEVEL9K_COLOR_SCHEME='dark'  # or 'light'
# See: https://github.com/romkatv/powerlevel10k`,
    },
    fish: {
        name: "Fish",
        fileLocation: "~/.config/fish/config.fish",
        fileLocationInstructions: [
            "Open your terminal",
            "Edit ~/.config/fish/config.fish",
            "Create the directory if it doesn't exist: mkdir -p ~/.config/fish",
            "Paste the configuration above",
            "Save the file and restart your terminal",
        ],
        snippet: `# Configure shell prompt to use terminal colors
set -gx WAVE_TERM_PALETTE 1

# For Oh-My-Posh:
# oh-my-posh init fish --config ~/.config/omp/minimal.json | source
# See: https://ohmyposh.dev/docs/config-colors

# For Starship:
# starship init fish | source
# Ensure your starship.toml uses terminal colors
# See: https://starship.rs/config/`,
    },
};

/**
 * Detect the most likely shell for the current platform
 */
function detectDefaultShell(platform: NodeJS.Platform): ShellType {
    if (platform === "win32") {
        return "powershell";
    } else if (platform === "darwin") {
        return "zsh"; // macOS default since Catalina
    } else {
        return "bash"; // Linux default
    }
}

/**
 * Get available shells for the current platform
 */
function getAvailableShells(platform: NodeJS.Platform): ShellType[] {
    if (platform === "win32") {
        return ["powershell", "bash"]; // PowerShell and Git Bash
    } else {
        return ["bash", "zsh", "fish"]; // Unix shells
    }
}

export const ShellProfileHelper = memo(() => {
    const platform = getApi().getPlatform();
    const defaultShell = useMemo(() => detectDefaultShell(platform), [platform]);
    const availableShells = useMemo(() => getAvailableShells(platform), [platform]);

    const [selectedShell, setSelectedShell] = useState<ShellType>(defaultShell);
    const [copied, setCopied] = useState(false);

    const config = SHELL_CONFIGS[selectedShell];

    const handleCopy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(config.snippet);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy to clipboard:", err);
        }
    }, [config.snippet]);

    const handleShellChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        setSelectedShell(e.target.value as ShellType);
        setCopied(false);
    }, []);

    return (
        <div className="shell-profile-helper">
            <div className="shell-profile-section">
                <h3 className="shell-profile-section-title">Shell Profile Configuration Helper</h3>
                <p className="shell-profile-description">
                    Select your shell and copy the configuration snippet to your profile file.
                </p>
            </div>

            <div className="shell-profile-section">
                <label className="shell-profile-label" htmlFor="shell-selector">
                    Select your shell:
                </label>
                <div className="shell-profile-selector-container">
                    <select
                        id="shell-selector"
                        className="shell-profile-selector"
                        value={selectedShell}
                        onChange={handleShellChange}
                    >
                        {availableShells.map((shell) => (
                            <option key={shell} value={shell}>
                                {SHELL_CONFIGS[shell].name}
                            </option>
                        ))}
                    </select>
                    <i className="fa fa-solid fa-chevron-down shell-profile-selector-icon" />
                </div>
            </div>

            <div className="shell-profile-section">
                <div className="shell-profile-snippet-header">
                    <span className="shell-profile-file-location">Add to: {config.fileLocation}</span>
                </div>
                <div className="shell-profile-snippet-container">
                    <pre className="shell-profile-snippet">{config.snippet}</pre>
                </div>
                <button className="shell-profile-copy-button" onClick={handleCopy} type="button">
                    {copied ? (
                        <>
                            <i className="fa fa-solid fa-check" />
                            <span>Copied!</span>
                        </>
                    ) : (
                        <>
                            <i className="fa fa-solid fa-copy" />
                            <span>Copy to Clipboard</span>
                        </>
                    )}
                </button>
            </div>

            <div className="shell-profile-section">
                <h4 className="shell-profile-instructions-title">How to apply this configuration:</h4>
                <ol className="shell-profile-instructions-list">
                    {config.fileLocationInstructions.map((instruction, index) => (
                        <li key={index}>{instruction}</li>
                    ))}
                </ol>
            </div>
        </div>
    );
});

ShellProfileHelper.displayName = "ShellProfileHelper";
