# TODO-001: Connections Auto-Detection Backend Service

## Title
Implement cross-platform shell detection backend service

## Current State
- WaveTerm has existing shell utility functions in `pkg/util/shellutil/shellutil.go`
- Functions like `DetectLocalShellPath()`, `DetectShellTypeAndVersion()`, `FindGitBash()` exist
- No RPC command exists for frontend to trigger shell detection
- No remote shell detection capability (SSH connections)

## What Needs to Be Implemented

### 1. New RPC Command: `DetectAvailableShellsCommand`

Create a new RPC command that detects available shells on the local system.

**Request:**
```go
type DetectShellsRequest struct {
    ConnectionName string `json:"connectionname,omitempty"` // Empty = local
}
```

**Response:**
```go
type DetectedShell struct {
    ID          string `json:"id"`          // Unique identifier (e.g., "pwsh-7")
    Name        string `json:"name"`        // Display name (e.g., "PowerShell 7")
    ShellPath   string `json:"shellpath"`   // Full path to executable
    ShellType   string `json:"shelltype"`   // bash, zsh, fish, pwsh, cmd
    Version     string `json:"version"`     // Version string if available
    Source      string `json:"source"`      // How detected (registry, file, etc.)
    Icon        string `json:"icon"`        // Suggested icon
    IsDefault   bool   `json:"isdefault"`   // Is this the system default?
}

type DetectShellsResponse struct {
    Shells []DetectedShell `json:"shells"`
    Error  string          `json:"error,omitempty"`
}
```

### 2. Platform-Specific Detection Logic

#### Windows Detection
- **PowerShell Core**: Scan `%ProgramFiles%\PowerShell`, Store apps, Scoop, dotnet tools
- **Windows PowerShell**: Static path `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`
- **Command Prompt**: Static path `%SystemRoot%\System32\cmd.exe`
- **WSL Distributions**: Registry `HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss`
- **Git Bash**: Registry `HKLM\SOFTWARE\GitForWindows` or `Git_is1` uninstall key
- **Cygwin**: Check common install path `C:\cygwin64\bin\bash.exe`

#### macOS/Linux Detection
- **System Shells**: Parse `/etc/shells`
- **Homebrew shells**: Check `/opt/homebrew/bin/` (macOS ARM), `/usr/local/bin/`
- **PowerShell Core**: Check `/usr/local/bin/pwsh`, `~/.dotnet/tools/pwsh`
- **User default**: Read `$SHELL` environment variable

### 3. Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `pkg/util/shellutil/shelldetect.go` | CREATE | Cross-platform shell detection |
| `pkg/util/shellutil/shelldetect_windows.go` | CREATE | Windows-specific detection |
| `pkg/util/shellutil/shelldetect_unix.go` | CREATE | Unix-specific detection (macOS/Linux) |
| `pkg/wshrpc/wshrpctypes.go` | MODIFY | Add DetectShellsRequest/Response types |
| `pkg/wshrpc/wshserver/wshserver.go` | MODIFY | Implement DetectAvailableShellsCommand |

### 4. Run `task generate` after implementation
This will generate TypeScript bindings in `frontend/app/store/wshclientapi.ts`

## Dependencies
- None (uses existing Go standard library and shellutil package)

## Acceptance Criteria
- [ ] New RPC command `DetectAvailableShellsCommand` is implemented
- [ ] Windows detection finds: CMD, PowerShell 5.1, PowerShell Core (if installed), WSL distros, Git Bash
- [ ] macOS detection finds: bash, zsh, fish (if installed), PowerShell Core (if installed)
- [ ] Linux detection finds: bash, zsh, fish (if installed), PowerShell Core (if installed)
- [ ] TypeScript bindings are generated via `task generate`
- [ ] Each detected shell has a unique ID, path, and shell type
- [ ] Detection handles missing shells gracefully (no errors for optional shells)

## Testing
- Test on Windows with WSL installed
- Test on macOS with Homebrew shells
- Test on Linux with default shells
- Verify TypeScript bindings work from frontend
