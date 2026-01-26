# Spec 011: Live OMP Theme Reload

## Overview
Enable hot-reloading of Oh-My-Posh theme changes without requiring the user to manually restart their shell.

## Problem Statement
When users change their OMP theme via the Appearance Panel, they currently need to:
1. Close the terminal
2. Open a new terminal
3. Wait for shell initialization

This creates a poor user experience. We need seamless theme updates.

## Proposed Solution

### Approach 1: Shell Re-initialization (Recommended)
Execute OMP's `init` command within the existing shell session.

**How OMP Hot Reload Works** (per https://ohmyposh.dev/docs/installation/customize):
- OMP uses shell functions that can be re-sourced
- PowerShell: `oh-my-posh init pwsh --config $env:POSH_THEME | Invoke-Expression`
- Bash: `eval "$(oh-my-posh init bash --config $POSH_THEME)"`
- Zsh: `eval "$(oh-my-posh init zsh --config $POSH_THEME)"`

### Implementation

#### 1. New IPC Command
```go
// pkg/wshrpc/wshrpctypes.go
type CommandOmpReinitData struct {
    BlockId string `json:"blockid"`
}

// In WshRpcInterface
OmpReinitCommand(ctx context.Context, data CommandOmpReinitData) error
```

#### 2. Backend Handler
```go
// pkg/wshrpc/wshserver/wshserver.go
func (ws *WshServer) OmpReinitCommand(ctx context.Context, data wshrpc.CommandOmpReinitData) error {
    // Get the block's shell type
    blockData, err := wstore.DBGet[*waveobj.Block](ctx, data.BlockId)
    if err != nil {
        return err
    }

    // Determine reinit command based on shell type
    shellType := blockData.Meta["term:shell"].(string)
    var reinitCmd string

    switch {
    case strings.Contains(shellType, "pwsh"), strings.Contains(shellType, "powershell"):
        reinitCmd = `oh-my-posh init pwsh --config $env:POSH_THEME | Invoke-Expression`
    case strings.Contains(shellType, "bash"):
        reinitCmd = `eval "$(oh-my-posh init bash --config $POSH_THEME)"`
    case strings.Contains(shellType, "zsh"):
        reinitCmd = `eval "$(oh-my-posh init zsh --config $POSH_THEME)"`
    default:
        return fmt.Errorf("unsupported shell type for OMP reinit: %s", shellType)
    }

    // Send command to the terminal
    return shellexec.SendCommandToTerminal(ctx, data.BlockId, reinitCmd)
}
```

#### 3. Frontend Trigger
```typescript
// After applying OMP theme change
const handleApplyTheme = async () => {
    // ... apply theme logic ...

    // Reinit OMP in all open terminals
    const activeBlocks = globalStore.get(atoms.tabAtom)?.blockids ?? [];
    for (const blockId of activeBlocks) {
        const blockData = globalStore.get(atoms.blockDataAtom(blockId));
        if (blockData?.meta?.["view"] === "term") {
            try {
                await RpcApi.OmpReinitCommand(TabRpcClient, { blockid: blockId });
            } catch (err) {
                console.warn(`Failed to reinit OMP for block ${blockId}:`, err);
            }
        }
    }
};
```

## Acceptance Criteria
- [ ] When OMP theme is changed, active terminals update without restart
- [ ] Works with PowerShell, Bash, and Zsh
- [ ] Handles errors gracefully (OMP not installed, invalid config)
- [ ] Optional: User can choose to reinit only active terminal or all terminals

## Security Considerations
- Only execute reinit command, not arbitrary user input
- Validate block exists and is a terminal before sending command
- Don't expose shell type detection to frontend (backend determines command)

## Edge Cases
- OMP not installed: Command will fail gracefully, show warning
- Invalid config path: OMP will show error in prompt, user can fix
- Remote connections: May need different handling for SSH sessions
