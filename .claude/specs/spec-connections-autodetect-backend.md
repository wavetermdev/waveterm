# Spec: Connections Auto-Detection Backend Service (TODO-001)

## Objective

Implement a cross-platform shell detection backend service that discovers available shells on the user's system and exposes them via RPC for the frontend to consume.

## Context

WaveTerm has existing shell utility functions in `pkg/util/shellutil/shellutil.go` with functions like `DetectLocalShellPath()`, `DetectShellTypeAndVersion()`, `FindGitBash()`. This spec adds a new RPC command that leverages and extends these capabilities.

## RPC Interface

### Request Type

```go
type DetectShellsRequest struct {
    ConnectionName string `json:"connectionname,omitempty"` // Empty = local
    Rescan         bool   `json:"rescan,omitempty"`         // Force cache refresh
}
```

### Response Type

```go
type DetectShellsResponse struct {
    Shells []DetectedShell `json:"shells"`
    Error  string          `json:"error,omitempty"` // Non-fatal errors
}
```

### Shell Type

```go
type DetectedShell struct {
    ID        string `json:"id"`                  // "pwsh-a1b2c3d4" (hash of path)
    Name      string `json:"name"`                // "PowerShell 7"
    ShellPath string `json:"shellpath"`           // "C:\...\pwsh.exe"
    ShellType string `json:"shelltype"`           // "pwsh", "bash", "zsh", "fish", "cmd"
    Version   string `json:"version,omitempty"`   // "7.4"
    Source    string `json:"source"`              // "file", "wsl", etc.
    Icon      string `json:"icon,omitempty"`      // "powershell", "terminal", "linux"
    IsDefault bool   `json:"isdefault,omitempty"` // true if system default
}
```

### ID Generation Algorithm

The `ID` field uses a deterministic hash of the shell path:
```go
func GenerateShellID(shellType, shellPath string) string {
    hash := sha256.Sum256([]byte(shellPath))
    return fmt.Sprintf("%s-%x", shellType, hash[:4]) // e.g., "pwsh-a1b2c3d4"
}
```

### Shell Type Constants

Add to `pkg/util/shellutil/shellutil.go`:
```go
const ShellType_cmd = "cmd"  // New constant for Command Prompt
```

### RPC Interface Method

Add to `pkg/wshrpc/wshrpctypes.go` in `WshRpcInterface`:
```go
DetectAvailableShellsCommand(ctx context.Context, data DetectShellsRequest) (DetectShellsResponse, error)
```

## Platform-Specific Detection

### Windows Detection Order

1. **Command Prompt** - Static path `%SystemRoot%\System32\cmd.exe`
2. **Windows PowerShell** - Static path `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`
3. **PowerShell Core** - Scan multiple locations:
   - `%ProgramFiles%\PowerShell\{version}\pwsh.exe`
   - `%ProgramFiles(x86)%\PowerShell\{version}\pwsh.exe`
   - `%LOCALAPPDATA%\Microsoft\WindowsApps\pwsh.exe` (Store)
   - `%USERPROFILE%\.dotnet\tools\pwsh.exe`
   - `%USERPROFILE%\scoop\shims\pwsh.exe`
4. **Git Bash** - Reuse existing `FindGitBash()` function
5. **WSL Distros** - Use `gowsl.RegisteredDistros()`, filter out docker-desktop
6. **Cygwin** - Check `C:\cygwin64\bin\bash.exe`, `C:\cygwin\bin\bash.exe`

### Unix Detection Order (macOS/Linux)

1. **Parse /etc/shells** - Standard system shells file
2. **Homebrew shells** - Check `/opt/homebrew/bin/`, `/usr/local/bin/`
3. **PowerShell Core** - `exec.LookPath("pwsh")` then known paths
4. **Additional shells** - Nushell, Elvish via PATH lookup

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `pkg/wshrpc/wshrpctypes.go` | MODIFY | Add `DetectShellsRequest`, `DetectedShell`, `DetectShellsResponse` types |
| `pkg/util/shellutil/shelldetect.go` | CREATE | Common shell detection logic, caching, ID generation |
| `pkg/util/shellutil/shelldetect_windows.go` | CREATE | Windows-specific detection |
| `pkg/util/shellutil/shelldetect_unix.go` | CREATE | Unix-specific detection |
| `pkg/wshrpc/wshserver/wshserver.go` | MODIFY | Add `DetectAvailableShellsCommand` implementation |

## Error Handling

| Scenario | Handling |
|----------|----------|
| Shell executable not found | Skip silently, log at debug level |
| Version detection fails | Set version to empty string, continue |
| /etc/shells unreadable | Return empty list for that source, log warning |
| WSL enumeration fails | Log error, return shells from other sources |
| Invalid shell path | Skip, do not add to list |

**Key Principle**: Individual shell detection failures should NOT fail the entire operation.

## Acceptance Criteria

- [ ] New RPC command `DetectAvailableShellsCommand` is implemented
- [ ] **Windows**: Detects CMD, Windows PowerShell 5.1, PowerShell Core (if installed)
- [ ] **Windows**: Detects WSL distributions (filters out docker-desktop)
- [ ] **Windows**: Detects Git Bash using existing `FindGitBash()` function
- [ ] **macOS**: Detects shells from /etc/shells (bash, zsh, etc.)
- [ ] **macOS**: Detects Homebrew shells (/opt/homebrew/bin/)
- [ ] **Linux**: Detects shells from /etc/shells
- [ ] **All platforms**: Detects PowerShell Core if installed
- [ ] Each shell has a unique, deterministic ID
- [ ] Default shell is correctly marked with `isdefault: true`
- [ ] Missing shells do not cause errors (graceful degradation)
- [ ] TypeScript bindings are generated via `task generate`
