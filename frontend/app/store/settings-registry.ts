// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Settings Registry
 *
 * This module provides a comprehensive registry of all settings with their metadata,
 * enabling dynamic GUI generation for the settings panel.
 */

// Category configuration with display order and icons
const categoryConfigMap: Record<string, CategoryConfig> = {
    Terminal: { order: 1, icon: "terminal", description: "Terminal appearance and behavior" },
    Editor: { order: 2, icon: "edit", description: "Code editor settings" },
    Window: { order: 3, icon: "window-maximize", description: "Window appearance and behavior" },
    AI: { order: 4, icon: "robot", description: "AI assistant configuration" },
    Web: { order: 5, icon: "globe", description: "Web browser settings" },
    Connections: { order: 6, icon: "plug", description: "Remote connection settings" },
    App: { order: 7, icon: "cog", description: "General application settings" },
    AutoUpdate: { order: 8, icon: "sync", description: "Automatic update settings" },
    Preview: { order: 9, icon: "file", description: "File preview settings" },
    Markdown: { order: 10, icon: "file-lines", description: "Markdown viewer settings" },
    Widget: { order: 11, icon: "th-large", description: "Widget launcher settings" },
    BlockHeader: { order: 12, icon: "heading", description: "Block header display settings" },
    Debug: { order: 13, icon: "bug", description: "Debugging and development options" },
};

// All settings metadata
const allSettings: SettingMetadata[] = [
    // ===================
    // TERMINAL SETTINGS
    // ===================
    {
        key: "term:fontsize",
        label: "Font Size",
        description: "The font size for terminal text in pixels.",
        category: "Terminal",
        subcategory: "Appearance",
        controlType: "slider",
        defaultValue: 12,
        type: "number",
        validation: { min: 8, max: 24, step: 1 },
        hideFromSettings: true,
        tags: ["font", "size", "text", "typography"],
    },
    {
        key: "term:fontfamily",
        label: "Font Family",
        description: "The font family used for terminal text. Should be a monospace font.",
        category: "Terminal",
        subcategory: "Appearance",
        controlType: "font",
        defaultValue: "",
        type: "string",
        hideFromSettings: true,
        tags: ["font", "typeface", "monospace"],
    },
    {
        key: "term:theme",
        label: "Color Scheme",
        description: "The color scheme for the terminal. Choose a theme with the right contrast for your background.",
        category: "Terminal",
        subcategory: "Appearance",
        controlType: "termtheme",
        defaultValue: "",
        type: "string",
        tags: ["color", "theme", "appearance", "scheme", "palette"],
        fullWidth: true,
        hideFromSettings: true,
    },
    {
        key: "term:scrollback",
        label: "Scrollback Lines",
        description: "The number of lines to keep in the terminal scrollback buffer.",
        category: "Terminal",
        subcategory: "Behavior",
        controlType: "number",
        defaultValue: 1000,
        type: "number",
        validation: { min: 100, max: 100000 },
        tags: ["buffer", "history", "scroll"],
    },
    {
        key: "term:copyonselect",
        label: "Copy on Select",
        description: "Automatically copy selected text to the clipboard.",
        category: "Terminal",
        subcategory: "Behavior",
        controlType: "toggle",
        defaultValue: true,
        type: "boolean",
        tags: ["clipboard", "selection", "copy"],
    },
    {
        key: "term:transparency",
        label: "Transparency",
        description: "Terminal background transparency level. Requires window transparency to be enabled.",
        category: "Terminal",
        subcategory: "Appearance",
        controlType: "slider",
        defaultValue: 0,
        type: "number",
        validation: { min: 0, max: 1, step: 0.1 },
        hideFromSettings: true,
        tags: ["opacity", "transparent", "background"],
        links: { "window transparency": "window:transparent" },
    },
    {
        key: "term:ligatures",
        label: "Font Ligatures",
        description: "Enable font ligatures for supported fonts (e.g., Fira Code, JetBrains Mono). Set a ligature-enabled Font Family to use this feature.",
        category: "Terminal",
        subcategory: "Appearance",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        hideFromSettings: true,
        tags: ["font", "ligatures", "typography"],
        links: { "Font Family": "term:fontfamily" },
    },
    {
        key: "term:disablewebgl",
        label: "Disable WebGL",
        description: "Disable WebGL rendering for the terminal. May help with GPU-related issues. See also Hardware Acceleration.",
        category: "Terminal",
        subcategory: "Performance",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        requiresRestart: true,
        tags: ["gpu", "rendering", "performance"],
        links: { "Hardware Acceleration": "window:disablehardwareacceleration" },
    },
    {
        key: "term:localshellpath",
        label: "Local Shell Path",
        description: "Path to the shell executable to use for local terminals.",
        category: "Terminal",
        subcategory: "Shell",
        controlType: "path",
        defaultValue: "",
        type: "string",
        tags: ["shell", "executable", "bash", "zsh", "powershell"],
    },
    {
        key: "term:localshellopts",
        label: "Local Shell Options",
        description: "Command-line arguments to pass to the local shell.",
        category: "Terminal",
        subcategory: "Shell",
        controlType: "stringlist",
        defaultValue: [],
        type: "string[]",
        tags: ["shell", "arguments", "options"],
    },
    {
        key: "term:gitbashpath",
        label: "Git Bash Path",
        description: "Path to Git Bash executable on Windows.",
        category: "Terminal",
        subcategory: "Shell",
        controlType: "path",
        defaultValue: "",
        type: "string",
        platform: "win32",
        tags: ["git", "bash", "windows"],
    },
    {
        key: "term:allowbracketedpaste",
        label: "Bracketed Paste",
        description: "Enable bracketed paste mode for compatible shells.",
        category: "Terminal",
        subcategory: "Behavior",
        controlType: "toggle",
        defaultValue: true,
        type: "boolean",
        tags: ["paste", "clipboard"],
    },
    {
        key: "term:shiftenternewline",
        label: "Shift+Enter for Newline",
        description: "Use Shift+Enter to insert a newline instead of executing the command.",
        category: "Terminal",
        subcategory: "Behavior",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        tags: ["keyboard", "shortcuts", "newline"],
    },
    {
        key: "term:macoptionismeta",
        label: "Option Key as Meta",
        description: "Use the Option key as Meta in the terminal (macOS only).",
        category: "Terminal",
        subcategory: "Behavior",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        platform: "darwin",
        tags: ["keyboard", "meta", "option", "macos"],
    },
    {
        key: "term:omptheme",
        label: "Oh-My-Posh Theme",
        description: "Browse and select an Oh-My-Posh theme for your terminal prompt. After selecting, configure OMP to use this theme in your shell profile.",
        category: "Terminal",
        subcategory: "Prompt Compatibility",
        controlType: "omptheme",
        defaultValue: "",
        type: "string",
        tags: ["omp", "oh-my-posh", "theme", "prompt", "powerline", "appearance"],
        fullWidth: true,
        hideFromSettings: true,
    },
    {
        key: "term:ompexport",
        label: "Oh-My-Posh Palette Export",
        description: "Export your current terminal Color Scheme as an Oh-My-Posh palette configuration. Copy the palette and add it to your OMP config file to match your prompt colors.",
        category: "Terminal",
        subcategory: "Prompt Compatibility",
        controlType: "omppalette",
        defaultValue: null,
        type: "string",
        tags: ["omp", "oh-my-posh", "palette", "export", "prompt", "powerline"],
        fullWidth: true,
        hideFromSettings: true,
        links: { "Color Scheme": "term:theme" },
    },
    {
        key: "term:promptcompat",
        label: "Prompt Compatibility Help",
        description: "Learn how to configure custom prompt frameworks (Oh-My-Posh, Starship, Powerlevel10k) to work seamlessly with Wave Terminal's theme system.",
        category: "Terminal",
        subcategory: "Prompt Compatibility",
        controlType: "promptcompat",
        defaultValue: null,
        type: "string",
        tags: ["prompt", "compatibility", "help", "omp", "starship", "powerlevel10k", "shell"],
        fullWidth: true,
        hideFromSettings: true,
    },

    // ===================
    // EDITOR SETTINGS
    // ===================
    {
        key: "editor:fontsize",
        label: "Font Size",
        description: "The font size for the code editor in pixels.",
        category: "Editor",
        subcategory: "Appearance",
        controlType: "slider",
        defaultValue: 12,
        type: "number",
        validation: { min: 8, max: 24, step: 1 },
        hideFromSettings: true,
        tags: ["font", "size", "text"],
    },
    {
        key: "editor:minimapenabled",
        label: "Show Minimap",
        description: "Display a minimap overview of the file on the right side.",
        category: "Editor",
        subcategory: "Appearance",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        hideFromSettings: true,
        tags: ["minimap", "overview", "navigation"],
    },
    {
        key: "editor:stickyscrollenabled",
        label: "Sticky Scroll",
        description: "Keep the current scope visible at the top of the editor while scrolling.",
        category: "Editor",
        subcategory: "Behavior",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        tags: ["scroll", "sticky", "scope"],
    },
    {
        key: "editor:wordwrap",
        label: "Word Wrap",
        description: "Wrap long lines to fit within the editor width.",
        category: "Editor",
        subcategory: "Behavior",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        tags: ["wrap", "lines", "text"],
    },
    {
        key: "editor:inlinediff",
        label: "Inline Diff",
        description: "Show inline diff view for AI-generated code changes.",
        category: "Editor",
        subcategory: "Behavior",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        tags: ["diff", "changes", "ai"],
    },

    // ===================
    // WINDOW SETTINGS
    // ===================
    {
        key: "window:transparent",
        label: "Transparent Window",
        description: "Enable window transparency. Required for terminal transparency.",
        category: "Window",
        subcategory: "Appearance",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        requiresRestart: true,
        hideFromSettings: true,
        tags: ["transparency", "opacity", "background"],
        links: { "terminal transparency": "term:transparency" },
    },
    {
        key: "window:blur",
        label: "Background Blur",
        description: "Apply blur effect to transparent window background.",
        category: "Window",
        subcategory: "Appearance",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        hideFromSettings: true,
        tags: ["blur", "transparency", "effect"],
        links: { "transparent window": "window:transparent" },
    },
    {
        key: "window:opacity",
        label: "Window Opacity",
        description: "Overall window opacity level when transparency is enabled.",
        category: "Window",
        subcategory: "Appearance",
        controlType: "slider",
        defaultValue: 1,
        type: "number",
        validation: { min: 0.1, max: 1, step: 0.05 },
        hideFromSettings: true,
        tags: ["opacity", "transparency"],
        links: { "transparency is enabled": "window:transparent" },
    },
    {
        key: "window:bgcolor",
        label: "Background Color",
        description: "Custom background color for the window.",
        category: "Window",
        subcategory: "Appearance",
        controlType: "color",
        defaultValue: "",
        type: "string",
        hideFromSettings: true,
        tags: ["color", "background"],
    },
    {
        key: "window:reducedmotion",
        label: "Reduced Motion",
        description: "Minimize animations throughout the application.",
        category: "Window",
        subcategory: "Accessibility",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        tags: ["animation", "motion", "accessibility"],
    },
    {
        key: "window:tilegapsize",
        label: "Tile Gap Size",
        description: "The gap between tiled blocks in pixels.",
        category: "Window",
        subcategory: "Layout",
        controlType: "number",
        defaultValue: 3,
        type: "number",
        validation: { min: 0, max: 20 },
        tags: ["layout", "tiles", "spacing"],
    },
    {
        key: "window:showmenubar",
        label: "Show Menu Bar",
        description: "Display the application menu bar.",
        category: "Window",
        subcategory: "Appearance",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        platform: "linux",
        tags: ["menu", "bar", "linux"],
    },
    {
        key: "window:nativetitlebar",
        label: "Native Title Bar",
        description: "Use the operating system's native title bar instead of the custom one.",
        category: "Window",
        subcategory: "Appearance",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        requiresRestart: true,
        tags: ["titlebar", "native", "chrome"],
    },
    {
        key: "window:disablehardwareacceleration",
        label: "Disable Hardware Acceleration",
        description: "Disable GPU hardware acceleration. May help with rendering issues. See also Disable WebGL for terminal-specific GPU settings.",
        category: "Window",
        subcategory: "Performance",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        requiresRestart: true,
        tags: ["gpu", "acceleration", "rendering"],
        links: { "Disable WebGL": "term:disablewebgl" },
    },
    {
        key: "window:fullscreenonlaunch",
        label: "Fullscreen on Launch",
        description: "Start the application in fullscreen mode.",
        category: "Window",
        subcategory: "Behavior",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        tags: ["fullscreen", "startup", "launch"],
    },
    {
        key: "window:confirmclose",
        label: "Confirm Close",
        description: "Ask for confirmation before closing the window.",
        category: "Window",
        subcategory: "Behavior",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        tags: ["close", "confirm", "warning"],
    },
    {
        key: "window:savelastwindow",
        label: "Save Last Window",
        description: "Remember and restore the last window position and size.",
        category: "Window",
        subcategory: "Behavior",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        tags: ["save", "restore", "position"],
    },
    {
        key: "window:zoom",
        label: "Interface Zoom",
        description: "Zoom level for the entire application interface.",
        category: "Window",
        subcategory: "Appearance",
        controlType: "slider",
        defaultValue: 1,
        type: "number",
        validation: { min: 0.5, max: 2, step: 0.1 },
        hideFromSettings: true,
        tags: ["zoom", "scale", "size"],
    },
    {
        key: "window:dimensions",
        label: "Default Dimensions",
        description: "Default window dimensions in WxH format (e.g., 1200x800).",
        category: "Window",
        subcategory: "Layout",
        controlType: "text",
        defaultValue: "",
        type: "string",
        validation: { pattern: "^\\d+x\\d+$" },
        tags: ["size", "dimensions", "width", "height"],
    },
    {
        key: "window:maxtabcachesize",
        label: "Max Tab Cache Size",
        description: "Maximum number of tabs to keep cached for quick switching.",
        category: "Window",
        subcategory: "Performance",
        controlType: "number",
        defaultValue: 10,
        type: "number",
        validation: { min: 1, max: 50 },
        tags: ["cache", "tabs", "memory"],
    },
    {
        key: "window:magnifiedblockopacity",
        label: "Magnified Block Opacity",
        description: "Opacity of magnified blocks.",
        category: "Window",
        subcategory: "Magnification",
        controlType: "slider",
        defaultValue: 0.6,
        type: "number",
        validation: { min: 0, max: 1, step: 0.1 },
        tags: ["magnify", "opacity", "block"],
    },
    {
        key: "window:magnifiedblocksize",
        label: "Magnified Block Size",
        description: "Size multiplier for magnified blocks.",
        category: "Window",
        subcategory: "Magnification",
        controlType: "slider",
        defaultValue: 0.9,
        type: "number",
        validation: { min: 0.5, max: 1, step: 0.05 },
        tags: ["magnify", "size", "block"],
    },
    {
        key: "window:magnifiedblockblurprimarypx",
        label: "Magnified Block Blur (Primary)",
        description: "Blur amount in pixels for the primary magnified block.",
        category: "Window",
        subcategory: "Magnification",
        controlType: "number",
        defaultValue: 10,
        type: "number",
        validation: { min: 0, max: 50 },
        tags: ["magnify", "blur", "effect"],
    },
    {
        key: "window:magnifiedblockblursecondarypx",
        label: "Magnified Block Blur (Secondary)",
        description: "Blur amount in pixels for secondary magnified blocks.",
        category: "Window",
        subcategory: "Magnification",
        controlType: "number",
        defaultValue: 2,
        type: "number",
        validation: { min: 0, max: 50 },
        tags: ["magnify", "blur", "effect"],
    },

    // ===================
    // AI SETTINGS
    // ===================
    {
        key: "ai:preset",
        label: "AI Preset",
        description: "The AI configuration preset to use.",
        category: "AI",
        subcategory: "Configuration",
        controlType: "select",
        defaultValue: "",
        type: "string",
        validation: { options: [] }, // Populated dynamically
        tags: ["preset", "configuration"],
    },
    {
        key: "ai:apitype",
        label: "API Type",
        description: "The type of AI API to use.",
        category: "AI",
        subcategory: "Configuration",
        controlType: "select",
        defaultValue: "",
        type: "string",
        validation: {
            options: [
                { value: "openai", label: "OpenAI" },
                { value: "anthropic", label: "Anthropic" },
                { value: "azure", label: "Azure OpenAI" },
                { value: "google-gemini", label: "Google Gemini" },
                { value: "openai-responses", label: "OpenAI Responses" },
                { value: "openai-chat", label: "OpenAI Chat" },
            ],
        },
        tags: ["api", "provider"],
    },
    {
        key: "ai:baseurl",
        label: "Base URL",
        description: "Custom base URL for the AI API endpoint.",
        category: "AI",
        subcategory: "Configuration",
        controlType: "text",
        defaultValue: "",
        type: "string",
        tags: ["url", "endpoint", "api"],
    },
    {
        key: "ai:apitoken",
        label: "API Token",
        description: "API token for authentication with the AI service.",
        category: "AI",
        subcategory: "Configuration",
        controlType: "text",
        defaultValue: "",
        type: "string",
        sensitive: true,
        tags: ["token", "authentication", "key"],
    },
    {
        key: "ai:model",
        label: "Model",
        description: "The AI model to use for completions.",
        category: "AI",
        subcategory: "Configuration",
        controlType: "text",
        defaultValue: "",
        type: "string",
        tags: ["model", "gpt", "claude"],
    },
    {
        key: "ai:maxtokens",
        label: "Max Tokens",
        description: "Maximum number of tokens for AI responses.",
        category: "AI",
        subcategory: "Limits",
        controlType: "number",
        defaultValue: 2048,
        type: "number",
        validation: { min: 100, max: 100000 },
        tags: ["tokens", "limit", "length"],
    },
    {
        key: "ai:timeoutms",
        label: "Timeout (ms)",
        description: "Timeout for AI requests in milliseconds.",
        category: "AI",
        subcategory: "Limits",
        controlType: "number",
        defaultValue: 60000,
        type: "number",
        validation: { min: 5000, max: 300000 },
        tags: ["timeout", "request"],
    },
    {
        key: "ai:proxyurl",
        label: "Proxy URL",
        description: "Proxy URL for AI API requests.",
        category: "AI",
        subcategory: "Network",
        controlType: "text",
        defaultValue: "",
        type: "string",
        tags: ["proxy", "network"],
    },
    {
        key: "ai:fontsize",
        label: "AI Panel Font Size",
        description: "Font size for text in the AI panel.",
        category: "AI",
        subcategory: "Appearance",
        controlType: "slider",
        defaultValue: 14,
        type: "number",
        validation: { min: 10, max: 24, step: 1 },
        hideFromSettings: true,
        tags: ["font", "size"],
    },
    {
        key: "ai:fixedfontsize",
        label: "AI Panel Code Font Size",
        description: "Font size for code blocks in the AI panel.",
        category: "AI",
        subcategory: "Appearance",
        controlType: "slider",
        defaultValue: 12,
        type: "number",
        validation: { min: 8, max: 20, step: 1 },
        hideFromSettings: true,
        tags: ["font", "code", "size"],
    },
    {
        key: "ai:name",
        label: "AI Name",
        description: "Display name for the AI assistant.",
        category: "AI",
        subcategory: "Configuration",
        controlType: "text",
        defaultValue: "",
        type: "string",
        tags: ["name", "display"],
    },
    {
        key: "ai:orgid",
        label: "Organization ID",
        description: "Organization ID for AI API (if required).",
        category: "AI",
        subcategory: "Configuration",
        controlType: "text",
        defaultValue: "",
        type: "string",
        tags: ["organization", "id"],
    },
    {
        key: "ai:apiversion",
        label: "API Version",
        description: "API version string for Azure OpenAI.",
        category: "AI",
        subcategory: "Configuration",
        controlType: "text",
        defaultValue: "",
        type: "string",
        tags: ["version", "azure"],
    },
    {
        key: "waveai:showcloudmodes",
        label: "Show Cloud Modes",
        description: "Show Wave AI cloud modes in the mode selector.",
        category: "AI",
        subcategory: "Configuration",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        tags: ["cloud", "modes", "wave"],
    },
    {
        key: "waveai:defaultmode",
        label: "Default Mode",
        description: "The default AI mode to use.",
        category: "AI",
        subcategory: "Configuration",
        controlType: "select",
        defaultValue: "",
        type: "string",
        validation: { options: [] }, // Populated dynamically
        tags: ["mode", "default"],
    },

    // ===================
    // WEB SETTINGS
    // ===================
    {
        key: "web:openlinksinternally",
        label: "Open Links Internally",
        description: "Open links in the built-in browser instead of the system browser.",
        category: "Web",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        tags: ["browser", "links", "internal"],
    },
    {
        key: "web:defaulturl",
        label: "Default URL",
        description: "The default URL to load in new web views.",
        category: "Web",
        controlType: "text",
        defaultValue: "https://github.com/wavetermdev/waveterm",
        type: "string",
        tags: ["url", "homepage", "start"],
    },
    {
        key: "web:defaultsearch",
        label: "Default Search Engine",
        description: "The default search engine URL (use %s for search query).",
        category: "Web",
        controlType: "text",
        defaultValue: "https://www.google.com/search?q=%s",
        type: "string",
        tags: ["search", "engine", "google"],
    },

    // ===================
    // CONNECTIONS SETTINGS
    // ===================
    {
        key: "conn:wshenabled",
        label: "Enable WSH",
        description: "Enable the Wave Shell (wsh) on remote connections.",
        category: "Connections",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        tags: ["wsh", "remote", "shell"],
    },
    {
        key: "conn:askbeforewshinstall",
        label: "Ask Before Installing WSH",
        description: "Prompt before installing wsh on remote systems. Only applies when Enable WSH is on.",
        category: "Connections",
        controlType: "toggle",
        defaultValue: true,
        type: "boolean",
        tags: ["wsh", "install", "prompt"],
        links: { "Enable WSH": "conn:wshenabled" },
    },

    // ===================
    // APP SETTINGS
    // ===================
    {
        key: "app:globalhotkey",
        label: "Global Hotkey",
        description: "Global keyboard shortcut to show/hide the application.",
        category: "App",
        controlType: "text",
        defaultValue: "",
        type: "string",
        tags: ["hotkey", "shortcut", "global"],
    },
    {
        key: "app:defaultnewblock",
        label: "Default New Block",
        description: "The default block type for new blocks.",
        category: "App",
        controlType: "select",
        defaultValue: "term",
        type: "string",
        validation: {
            options: [
                { value: "term", label: "Terminal" },
                { value: "preview", label: "Preview" },
                { value: "web", label: "Web" },
            ],
        },
        tags: ["block", "default", "new"],
    },
    {
        key: "app:showoverlayblocknums",
        label: "Show Block Numbers",
        description: "Display block numbers as overlay on hover.",
        category: "App",
        controlType: "toggle",
        defaultValue: true,
        type: "boolean",
        tags: ["blocks", "numbers", "overlay"],
    },
    {
        key: "app:ctrlvpaste",
        label: "Ctrl+V to Paste",
        description: "Use Ctrl+V for paste instead of terminal passthrough.",
        category: "App",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        platform: "win32",
        tags: ["paste", "clipboard", "keyboard"],
    },
    {
        key: "app:theme",
        label: "UI Theme",
        description: "The UI color theme for the application (dark, light, or system).",
        category: "App",
        subcategory: "Appearance",
        controlType: "select",
        defaultValue: "dark",
        type: "string",
        validation: {
            options: [
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
                { value: "system", label: "System" },
            ],
        },
        hideFromSettings: true,
        tags: ["theme", "appearance", "dark", "light", "mode"],
    },
    {
        key: "app:accent",
        label: "Accent Theme",
        description: "The accent color palette for the application UI.",
        category: "App",
        subcategory: "Appearance",
        controlType: "select",
        defaultValue: "green",
        type: "string",
        validation: {
            options: [
                { value: "green", label: "Green" },
                { value: "warm", label: "Warm" },
                { value: "blue", label: "Blue" },
                { value: "purple", label: "Purple" },
                { value: "teal", label: "Teal" },
            ],
        },
        hideFromSettings: true,
        tags: ["accent", "theme", "color", "appearance"],
    },
    {
        key: "app:themeoverrides",
        label: "Theme Overrides",
        description: "CSS variable overrides applied on top of current theme and accent.",
        category: "App",
        subcategory: "Appearance",
        controlType: "text",
        defaultValue: {},
        type: "object",
        hideFromSettings: true,
        tags: ["theme", "overrides", "css", "custom"],
    },
    {
        key: "app:customaccents",
        label: "Custom Accents",
        description: "Named custom accent themes with saved CSS variable override maps.",
        category: "App",
        subcategory: "Appearance",
        controlType: "text",
        defaultValue: {},
        type: "object",
        hideFromSettings: true,
        tags: ["accent", "custom", "theme"],
    },
    {
        key: "app:dismissarchitecturewarning",
        label: "Dismiss Architecture Warning",
        description: "Dismiss the warning about running on non-native architecture.",
        category: "App",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        tags: ["warning", "architecture", "arm"],
    },

    // ===================
    // AUTOUPDATE SETTINGS
    // ===================
    {
        key: "autoupdate:enabled",
        label: "Auto Update",
        description: "Automatically check for and install updates.",
        category: "AutoUpdate",
        controlType: "toggle",
        defaultValue: true,
        type: "boolean",
        tags: ["update", "automatic"],
    },
    {
        key: "autoupdate:installonquit",
        label: "Install on Quit",
        description: "Install downloaded updates when quitting the application.",
        category: "AutoUpdate",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        tags: ["update", "install", "quit"],
    },
    {
        key: "autoupdate:intervalms",
        label: "Check Interval (ms)",
        description: "Interval between automatic update checks in milliseconds.",
        category: "AutoUpdate",
        controlType: "number",
        defaultValue: 3600000,
        type: "number",
        validation: { min: 60000, max: 86400000 },
        tags: ["interval", "check", "frequency"],
    },
    {
        key: "autoupdate:channel",
        label: "Update Channel",
        description: "The release channel for updates.",
        category: "AutoUpdate",
        controlType: "select",
        defaultValue: "stable",
        type: "string",
        validation: {
            options: [
                { value: "stable", label: "Stable" },
                { value: "beta", label: "Beta" },
                { value: "nightly", label: "Nightly" },
            ],
        },
        tags: ["channel", "release", "beta"],
    },

    // ===================
    // PREVIEW SETTINGS
    // ===================
    {
        key: "preview:showhiddenfiles",
        label: "Show Hidden Files",
        description: "Show hidden files and directories in the file preview.",
        category: "Preview",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        tags: ["hidden", "files", "dotfiles"],
    },

    // ===================
    // MARKDOWN SETTINGS
    // ===================
    {
        key: "markdown:fontsize",
        label: "Font Size",
        description: "Font size for rendered markdown text.",
        category: "Markdown",
        controlType: "slider",
        defaultValue: 14,
        type: "number",
        validation: { min: 10, max: 24, step: 1 },
        tags: ["font", "size"],
    },
    {
        key: "markdown:fixedfontsize",
        label: "Code Font Size",
        description: "Font size for code blocks in markdown.",
        category: "Markdown",
        controlType: "slider",
        defaultValue: 12,
        type: "number",
        validation: { min: 8, max: 20, step: 1 },
        tags: ["font", "code", "size"],
    },

    // ===================
    // WIDGET SETTINGS
    // ===================
    {
        key: "widget:showhelp",
        label: "Show Help",
        description: "Show help text for widgets in the launcher.",
        category: "Widget",
        controlType: "toggle",
        defaultValue: true,
        type: "boolean",
        tags: ["help", "tooltip", "launcher"],
    },

    // ===================
    // BLOCK HEADER SETTINGS
    // ===================
    {
        key: "blockheader:showblockids",
        label: "Show Block IDs",
        description: "Display block IDs in block headers.",
        category: "BlockHeader",
        controlType: "toggle",
        defaultValue: false,
        type: "boolean",
        tags: ["block", "id", "debug"],
    },

    // ===================
    // TAB SETTINGS
    // ===================
    {
        key: "tab:preset",
        label: "Tab Preset",
        description: "Default preset for new tabs.",
        category: "App",
        subcategory: "Tabs",
        controlType: "select",
        defaultValue: "",
        type: "string",
        validation: { options: [] }, // Populated dynamically
        tags: ["tab", "preset"],
    },

    // ===================
    // DEBUG SETTINGS
    // ===================
    {
        key: "debug:pprofport",
        label: "pprof Port",
        description: "Port number for Go pprof debugging server.",
        category: "Debug",
        controlType: "number",
        defaultValue: null,
        type: "number",
        validation: { min: 1024, max: 65535 },
        tags: ["pprof", "debug", "profiling"],
    },
    {
        key: "debug:pprofmemprofilerate",
        label: "pprof Memory Profile Rate",
        description: "Memory profiling sample rate for pprof.",
        category: "Debug",
        controlType: "number",
        defaultValue: null,
        type: "number",
        validation: { min: 0, max: 1000000 },
        tags: ["pprof", "memory", "profiling"],
    },
];

// Build the settings registry map
const settingsRegistry: Map<string, SettingMetadata> = new Map();
for (const setting of allSettings) {
    settingsRegistry.set(setting.key, setting);
}

// Build the settings by category map
const settingsByCategory: Map<string, SettingMetadata[]> = new Map();
for (const setting of allSettings) {
    const category = setting.category;
    if (!settingsByCategory.has(category)) {
        settingsByCategory.set(category, []);
    }
    settingsByCategory.get(category)!.push(setting);
}

/**
 * Get metadata for a specific setting by key.
 */
function getSettingMetadata(key: string): SettingMetadata | undefined {
    return settingsRegistry.get(key);
}

/**
 * Get the default value for a setting.
 */
function getDefaultValue(key: string): boolean | number | string | string[] | null {
    const metadata = settingsRegistry.get(key);
    return metadata?.defaultValue ?? null;
}

/**
 * Get category configuration.
 */
function getCategoryConfig(category: string): CategoryConfig | undefined {
    return categoryConfigMap[category];
}

/**
 * Get all category names in display order.
 */
function getOrderedCategories(): string[] {
    return Object.entries(categoryConfigMap)
        .sort((a, b) => a[1].order - b[1].order)
        .map(([name]) => name);
}

/**
 * Search settings by query string.
 * Matches against key, label, description, and tags.
 */
function searchSettings(query: string): SettingMetadata[] {
    if (!query || query.trim() === "") {
        return Array.from(settingsRegistry.values()).filter((s) => !s.hideFromSettings);
    }

    const normalizedQuery = query.toLowerCase().trim();
    const results: SettingMetadata[] = [];

    for (const setting of settingsRegistry.values()) {
        if (setting.hideFromSettings) continue;

        // Check key
        if (setting.key.toLowerCase().includes(normalizedQuery)) {
            results.push(setting);
            continue;
        }

        // Check label
        if (setting.label.toLowerCase().includes(normalizedQuery)) {
            results.push(setting);
            continue;
        }

        // Check description
        if (setting.description.toLowerCase().includes(normalizedQuery)) {
            results.push(setting);
            continue;
        }

        // Check category
        if (setting.category.toLowerCase().includes(normalizedQuery)) {
            results.push(setting);
            continue;
        }

        // Check subcategory
        if (setting.subcategory?.toLowerCase().includes(normalizedQuery)) {
            results.push(setting);
            continue;
        }

        // Check tags
        if (setting.tags?.some((tag) => tag.toLowerCase().includes(normalizedQuery))) {
            results.push(setting);
            continue;
        }
    }

    return results;
}

/**
 * Get all settings for the current platform.
 */
function getSettingsForPlatform(platform: "darwin" | "win32" | "linux"): SettingMetadata[] {
    return Array.from(settingsRegistry.values()).filter(
        (setting) =>
            !setting.hideFromSettings &&
            (!setting.platform || setting.platform === "all" || setting.platform === platform)
    );
}

/**
 * Get all settings grouped by category for the current platform.
 */
function getSettingsByCategoryForPlatform(
    platform: "darwin" | "win32" | "linux"
): Map<string, SettingMetadata[]> {
    const result = new Map<string, SettingMetadata[]>();
    const platformSettings = getSettingsForPlatform(platform);

    for (const setting of platformSettings) {
        const category = setting.category;
        if (!result.has(category)) {
            result.set(category, []);
        }
        result.get(category)!.push(setting);
    }

    return result;
}

/**
 * Get subcategories for a category, ordered by first appearance in settings list.
 * Returns an array of unique subcategory names (excluding undefined).
 */
function getSubcategoriesForCategory(
    category: string,
    platform: "darwin" | "win32" | "linux"
): string[] {
    const settingsByCategory = getSettingsByCategoryForPlatform(platform);
    const settings = settingsByCategory.get(category);
    if (!settings) return [];

    const subcategories: string[] = [];
    const seen = new Set<string>();

    for (const setting of settings) {
        if (setting.subcategory && !seen.has(setting.subcategory)) {
            seen.add(setting.subcategory);
            subcategories.push(setting.subcategory);
        }
    }

    return subcategories;
}

export {
    settingsRegistry,
    settingsByCategory,
    categoryConfigMap,
    getSettingMetadata,
    getDefaultValue,
    getCategoryConfig,
    getOrderedCategories,
    searchSettings,
    getSettingsForPlatform,
    getSettingsByCategoryForPlatform,
    getSubcategoriesForCategory,
};
