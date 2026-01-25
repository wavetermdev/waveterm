# Prompt Compatibility Helper - Implementation Specification

## Overview

Design and implement a Prompt Compatibility help section and shell profile helper for Wave Terminal settings. This feature will help users configure their shell prompts (Oh-My-Posh, Starship, Powerlevel10k) to work correctly with Wave Terminal's theme system.

## Problem Statement

Many users use custom prompt frameworks (Oh-My-Posh, Starship, Powerlevel10k) that define their own color schemes. These colors don't automatically change when the user switches terminal themes in Wave, leading to poor contrast and readability issues.

## Solution

Add a new "Prompt Compatibility" subcategory under Terminal settings that:
1. Explains why prompt colors don't change with terminal themes
2. Provides links to documentation for popular prompt frameworks
3. Offers a shell-specific configuration generator with copy-to-clipboard functionality

## Architecture Design

### Component Structure

```
frontend/app/view/waveconfig/
├── prompt-compatibility-help.tsx    # Main help section component
└── shell-profile-helper.tsx         # Shell configuration generator

frontend/app/store/
└── settings-registry.ts             # Add new settings metadata
```

### Data Flow

1. User navigates to Terminal > Prompt Compatibility in settings
2. `PromptCompatibilityHelp` component renders documentation and embeds `ShellProfileHelper`
3. `ShellProfileHelper` detects user's platform and current shell
4. User selects their shell type (if multiple detected)
5. Component generates shell-specific configuration snippets
6. User copies snippet to clipboard
7. Component shows instructions for where to paste the configuration

## Component Design

### 1. PromptCompatibilityHelp Component

**File**: `frontend/app/view/waveconfig/prompt-compatibility-help.tsx`

**Responsibilities**:
- Render explanation of prompt compatibility issues
- Display links to popular prompt framework documentation
- Embed the ShellProfileHelper component
- Use existing settings UI patterns

**Props**:
```typescript
interface PromptCompatibilityHelpProps {
    // No props needed - standalone component
}
```

**Key Features**:
- Informational text explaining the issue
- Links to Oh-My-Posh, Starship, Powerlevel10k docs
- Integration with ShellProfileHelper
- Consistent styling with existing settings

### 2. ShellProfileHelper Component

**File**: `frontend/app/view/waveconfig/shell-profile-helper.tsx`

**Responsibilities**:
- Detect user's platform (Windows, macOS, Linux)
- Determine likely shell type
- Generate shell-specific configuration snippets
- Provide copy-to-clipboard functionality
- Show instructions for configuration file location

**Props**:
```typescript
interface ShellProfileHelperProps {
    // No props needed - uses global API
}
```

**State**:
```typescript
interface ShellProfileHelperState {
    selectedShell: ShellType;
    copied: boolean;
}

type ShellType = "powershell" | "bash" | "zsh" | "fish";
```

**Key Features**:
- Platform detection using `getApi().getPlatform()`
- Shell type selector (dropdown)
- Configuration snippet display with syntax highlighting
- Copy button with visual feedback
- File location instructions

## Configuration Snippets

### PowerShell (Windows)
```powershell
# Add to: $PROFILE (or ~\Documents\PowerShell\Microsoft.PowerShell_profile.ps1)

# Configure Oh-My-Posh to use Wave Terminal colors
$env:WAVE_TERM_PALETTE = $true
# For Oh-My-Posh, use a minimal theme or configure it to use terminal colors
# oh-my-posh init pwsh --config "$env:POSH_THEMES_PATH/minimal.omp.json" | Invoke-Expression
```

### Bash (Linux/macOS/Git Bash)
```bash
# Add to: ~/.bashrc (Linux) or ~/.bash_profile (macOS)

# Configure shell prompt to use terminal colors
export WAVE_TERM_PALETTE=1

# For Oh-My-Posh:
# eval "$(oh-my-posh init bash --config ~/.config/omp/minimal.json)"

# For Starship:
# eval "$(starship init bash)"
# And ensure your starship.toml uses terminal colors
```

### Zsh (macOS/Linux)
```bash
# Add to: ~/.zshrc

# Configure shell prompt to use terminal colors
export WAVE_TERM_PALETTE=1

# For Oh-My-Posh:
# eval "$(oh-my-posh init zsh --config ~/.config/omp/minimal.json)"

# For Starship:
# eval "$(starship init zsh)"
# And ensure your starship.toml uses terminal colors

# For Powerlevel10k:
# Use terminal colors by setting:
# POWERLEVEL10K_COLOR_SCHEME='dark'  # or 'light'
```

### Fish (Linux/macOS)
```fish
# Add to: ~/.config/fish/config.fish

# Configure shell prompt to use terminal colors
set -gx WAVE_TERM_PALETTE 1

# For Oh-My-Posh:
# oh-my-posh init fish --config ~/.config/omp/minimal.json | source

# For Starship:
# starship init fish | source
# And ensure your starship.toml uses terminal colors
```

## Settings Registry Integration

Add new setting metadata in `settings-registry.ts`:

```typescript
{
    key: "term:promptcompatibility",
    label: "Prompt Compatibility",
    description: "Help configuring custom prompts (Oh-My-Posh, Starship, Powerlevel10k) to work with Wave Terminal themes.",
    category: "Terminal",
    subcategory: "Prompt Compatibility",
    controlType: "custom",
    defaultValue: null,
    type: "null",
    tags: ["prompt", "theme", "oh-my-posh", "starship", "powerlevel10k"],
    fullWidth: true,
    customComponent: PromptCompatibilityHelp,
}
```

## UI/UX Design

### Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│ Prompt Compatibility                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Why don't prompt colors change with my terminal theme?     │
│                                                             │
│ Custom prompt frameworks like Oh-My-Posh, Starship, and    │
│ Powerlevel10k define their own color schemes that don't    │
│ automatically update when you change Wave's terminal theme. │
│                                                             │
│ To fix this, you need to configure your prompt to use      │
│ terminal colors instead of hardcoded colors.               │
│                                                             │
│ Documentation Links:                                        │
│ • Oh-My-Posh: https://ohmyposh.dev/docs/config-colors      │
│ • Starship: https://starship.rs/config/                    │
│ • Powerlevel10k: https://github.com/romkatv/p10k          │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Shell Profile Configuration Helper                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Select your shell: [Dropdown: PowerShell ▼]                │
│                                                             │
│ ┌───────────────────────────────────────────────────────┐ │
│ │ # Add to: $PROFILE                                    │ │
│ │                                                       │ │
│ │ # Configure Oh-My-Posh to use Wave Terminal colors   │ │
│ │ $env:WAVE_TERM_PALETTE = $true                       │ │
│ │ ...                                                   │ │
│ └───────────────────────────────────────────────────────┘ │
│                                                             │
│ [Copy to Clipboard] ✓ Copied!                             │
│                                                             │
│ Where to add this:                                          │
│ • Open PowerShell                                           │
│ • Type: notepad $PROFILE                                    │
│ • Paste the configuration above                             │
│ • Save and restart your terminal                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Visual Design

- Use existing settings control styles from `settings-controls.scss`
- Snippet box with monospace font and subtle background
- Copy button with success animation (checkmark)
- Clear visual hierarchy with sections
- Responsive layout that works at different widths

## Implementation Phases

### Phase 1: Component Structure
- [ ] Create `prompt-compatibility-help.tsx` with basic layout
- [ ] Create `shell-profile-helper.tsx` with shell detection
- [ ] Add to settings registry with `fullWidth: true`
- [ ] Test rendering in settings panel

### Phase 2: Shell Detection & Selection
- [ ] Implement platform detection
- [ ] Add shell type selector dropdown
- [ ] Generate shell-specific snippets based on selection
- [ ] Display correct file location instructions

### Phase 3: Copy Functionality
- [ ] Implement clipboard copy using `navigator.clipboard.writeText()`
- [ ] Add copy success feedback (checkmark animation)
- [ ] Handle copy errors gracefully
- [ ] Test across browsers

### Phase 4: Documentation & Polish
- [ ] Add comprehensive help text
- [ ] Include links to external documentation
- [ ] Add tips for each prompt framework
- [ ] Ensure responsive layout
- [ ] Test on all platforms

## Technical Details

### Platform Detection

```typescript
import { getApi } from "@/app/store/global";

const platform = getApi().getPlatform(); // "darwin" | "win32" | "linux"
```

### Shell Type Mapping

```typescript
const SHELL_CONFIGS = {
    powershell: {
        name: "PowerShell",
        fileLocation: "$PROFILE",
        fileLocationFull: "~\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1",
        snippet: "...",
    },
    bash: {
        name: "Bash",
        fileLocation: "~/.bashrc (Linux) or ~/.bash_profile (macOS)",
        snippet: "...",
    },
    zsh: {
        name: "Zsh",
        fileLocation: "~/.zshrc",
        snippet: "...",
    },
    fish: {
        name: "Fish",
        fileLocation: "~/.config/fish/config.fish",
        snippet: "...",
    },
};
```

### Clipboard API

```typescript
const handleCopy = async () => {
    try {
        await navigator.clipboard.writeText(snippet);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    } catch (err) {
        console.error("Failed to copy:", err);
    }
};
```

## Error Handling

- **Clipboard API unavailable**: Show fallback message to manually copy
- **Platform detection fails**: Default to showing all shell options
- **Invalid shell selection**: Validate and show error message

## Testing Checklist

- [ ] Renders correctly in Terminal settings category
- [ ] Platform detection works on Windows, macOS, Linux
- [ ] Shell selector updates snippet correctly
- [ ] Copy button copies correct text to clipboard
- [ ] Copy success feedback displays correctly
- [ ] Links open in browser
- [ ] Responsive layout at different widths
- [ ] Works with light and dark themes
- [ ] Accessible keyboard navigation
- [ ] No console errors

## Future Enhancements

1. **Auto-detection**: Try to detect which prompt framework is installed
2. **Live Preview**: Show what the prompt will look like with terminal colors
3. **Validation**: Check if the configuration is already present
4. **Interactive Tutorial**: Step-by-step guide with screenshots
5. **Framework-Specific Configs**: Pre-configured themes for each framework

## References

### Existing Code Patterns

- Settings control structure: `frontend/app/element/settings/setting-control.tsx`
- Settings registry: `frontend/app/store/settings-registry.ts`
- Platform utilities: `frontend/util/platformutil.ts`
- Clipboard usage: `frontend/app/app.tsx:251` (navigator.clipboard.writeText)
- Full-width controls: `frontend/app/element/settings/termtheme-control.tsx`

### External Documentation

- Oh-My-Posh: https://ohmyposh.dev/docs/config-colors
- Starship: https://starship.rs/config/
- Powerlevel10k: https://github.com/romkatv/powerlevel10k

## Success Criteria

1. Users can easily find prompt compatibility help in settings
2. Configuration snippets are accurate for each shell
3. Copy-to-clipboard works reliably
4. Instructions are clear and easy to follow
5. Component integrates seamlessly with existing settings UI
6. No performance impact on settings panel
