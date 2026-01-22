# Wave Terminal OSC 16162 Escape Sequences

Wave Terminal uses a custom OSC (Operating System Command) escape sequence numbered **16162** for shell integration. This allows the shell to communicate its state and events to the terminal.

## Format

All commands use this escape sequence format:

```
ESC ] 16162 ; command [;<json-data>] BEL
```

Where:
- `ESC` = `\033` (escape character)
- `BEL` = `\007` (bell character)
- `command` = Single letter (A, C, M, D, I, or R)
- `<json-data>` = Optional JSON payload (depends on command)

## Commands

### A - Prompt Start

Marks the beginning of a new shell prompt.

**Format:** `A`

**When:** Sent in `precmd` hook (after previous command completes, before new prompt is displayed)

**Purpose:** Signals to the terminal that a new prompt is being drawn. This helps Wave Terminal distinguish between prompt output and command output.

**Example:**
```bash
printf '\033]16162;A\007'
```

---

### C - Command Execution

Sent immediately before a command is executed, optionally including the command text.

**Format:** `C[;<json-data>]`

**Data Type:**
```typescript
{
  cmd64?: string;  // base64-encoded command text
}
```

**When:** Sent in `preexec` hook (after user presses Enter, before command runs)

**Purpose:** Notifies the terminal that a command is about to execute. The command text is base64-encoded to handle special characters safely.

**Example:**
```bash
cmd64=$(printf '%s' "ls -la" | base64)
printf '\033]16162;C;{"cmd64":"%s"}\007' "$cmd64"
```

---

### M - Metadata

Sends shell metadata information (typically only once at shell initialization).

**Format:** `M;<json-data>`

**Data Type:**
```typescript
{
  shell?: string;        // Shell name (e.g., "zsh", "bash")
  shellversion?: string; // Version string of the shell
  uname?: string;        // Output of "uname -smr" (e.g., "Darwin 23.0.0 arm64")
  integration?: boolean; // Whether shell integration is active (true) or disabled (false)
}
```

**When:** Sent during first `precmd` hook (on shell startup)

**Purpose:** Provides Wave Terminal with information about the shell environment and operating system.

**Example:**
```bash
uname_info=$(uname -smr 2>/dev/null)
printf '\033]16162;M;{"shell":"zsh","shellversion":"5.9","uname":"%s"}\007' "$uname_info"
```

---

### D - Done (Exit Status)

Reports the exit status of the previously executed command.

**Format:** `D;<json-data>`

**Data Type:**
```typescript
{
  exitcode?: number;  // Exit status code of the previous command
}
```

**When:** Sent in `precmd` hook (after command completes)

**Purpose:** Communicates whether the previous command succeeded or failed, allowing Wave Terminal to display success/failure indicators.

**Example:**
```bash
# After command exits with status 0
printf '\033]16162;D;{"exitcode":0}\007'

# After command exits with status 1
printf '\033]16162;D;{"exitcode":1}\007'
```

---

### I - Input Status

Reports the current state of the command line input buffer.

**Format:** `I;<json-data>`

**Data Type:**
```typescript
{
  inputempty?: boolean;  // Whether the command line buffer is empty
}
```

**When:** Sent during ZLE (Zsh Line Editor) hooks when buffer state changes
- `zle-line-init` - When line editor is initialized
- `zle-line-pre-redraw` - Before line is redrawn

**Purpose:** Allows Wave Terminal to track the state of the command line input. Currently reports whether the buffer is empty, but may be extended to include additional input state information in the future.

**Example:**
```bash
# When buffer is empty
I;{"inputempty":true}

# When buffer has content
I;{"inputempty":false}
```

### R - Reset Alternate Buffer

Resets the terminal if it's in alternate buffer mode.

**Format:** `R`

**When:** Can be sent at any time to ensure terminal is not stuck in alternate buffer mode

**Purpose:** If the terminal is currently displaying the alternate screen buffer, this command switches back to the normal buffer. This is useful for recovering from programs that crash without properly restoring the screen.

**Behavior:**
- Checks if terminal is in alternate buffer mode (`terminal.buffer.active.type === "alternate"`)
- If in alternate mode, sends `ESC [ ? 1049 l` to exit alternate buffer
- If not in alternate mode, does nothing

**Example:**
```bash
R
```

---

## Typical Command Flow

Here's the typical sequence during shell interaction:

```
1. Shell starts
   → M;<json> (metadata - shell info)
   
2. First prompt appears
   → A (prompt start)
   
3. User types command and presses Enter
   → I;{"inputempty":false} (input no longer empty - sent as user types)
   → C;{"cmd64":"..."} (command about to execute)
   
4. Command runs and completes
   → D;{"exitcode":<status>} (exit status)
   → I;{"inputempty":true} (input empty again)
   → A (next prompt start)
   
5. Repeat from step 3...
```

## Implementation Notes

- Shell integration is **disabled** when running inside tmux or screen (`TMUX`, `STY` environment variables, or `tmux*`/`screen*` TERM values)
- Commands are base64-encoded in the C sequence to safely handle special characters, newlines, and control characters
- The I (input empty) command is only sent when the state changes (not on every keystroke)
- The M (metadata) command is only sent once during the first precmd
- The D (exit status) command is skipped during the first precmd (no previous command to report)

## Related Files

- [`pkg/util/shellutil/shellintegration/zsh_zshrc.sh`](pkg/util/shellutil/shellintegration/zsh_zshrc.sh) - Zsh shell integration implementation
- Similar integrations exist for bash and other shells

## Standard OSC 7

Wave Terminal also uses the standard **OSC 7** sequence for reporting the current working directory:

**Format:** `7;file://<hostname><encoded_path>`

This is sent:
- During first precmd (after metadata)
- In the `chpwd` hook (whenever directory changes)

The path is URL-encoded to safely handle special characters.