# TODO-002: Connections Auto-Detection UI

## Title
Add auto-detection button and UI to Connections settings page

## Current State
- `frontend/app/view/waveconfig/connections-content.tsx` has two-panel UI
- Supports SSH and WSL connection types
- No auto-detection trigger exists
- Empty state shows generic message, no suggestion to auto-detect

## What Needs to Be Implemented

### 1. Auto-Detect Button in Toolbar

Add a button to the connections list header that triggers shell detection.

**Location:** Next to "Add Connection" button in the toolbar area

**UI:**
```
+------------------------------------------+
| Connections                    [🔍] [+]  |
+------------------------------------------+
```

- 🔍 = Auto-detect button (magnifying glass + lightning or wand icon)
- [+] = Existing add connection button

### 2. Empty State Enhancement

When no connections exist, show a prominent auto-detect option:

```
+------------------------------------------+
|                                          |
|    🔍 No connections configured          |
|                                          |
|    Wave can automatically detect         |
|    available shells on your system.      |
|                                          |
|    [🔍 Auto-Detect Shells]               |
|                                          |
|    Or manually add a connection:         |
|    [+ Add Connection]                    |
|                                          |
+------------------------------------------+
```

### 3. Detection Results Dialog/Panel

Show detected shells with checkboxes for selection:

```
+------------------------------------------+
| Detected Shells (5)              [Close] |
+------------------------------------------+
| ☑ PowerShell 7.4.0                       |
|   pwsh - C:\Program Files\PowerShell\7\  |
|                                          |
| ☑ Windows PowerShell                     |
|   powershell - System default            |
|                                          |
| ☑ Ubuntu (WSL)                           |
|   wsl - /bin/bash                        |
|                                          |
| ☑ Git Bash                               |
|   bash - C:\Program Files\Git\bin\       |
|                                          |
| ☐ Command Prompt                         |
|   cmd - System default                   |
|                                          |
+------------------------------------------+
| Selected: 4                [Add Selected]|
+------------------------------------------+
```

### 4. Connection Creation from Detection

When user selects shells and clicks "Add Selected":
- Create connection entries in `connections.json`
- Use detected shell info to populate:
  - Connection name: Shell display name
  - `conn:shellpath`: Detected shell path
  - `display:icon`: Appropriate icon based on shell type
  - For WSL: Set connection type to "wsl", use distro name

### 5. Duplicate Detection

Before adding:
- Check if connection with same shell path already exists
- Show indicator for already-configured shells (greyed out checkbox, "Already configured" label)

### 6. Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `frontend/app/view/waveconfig/connections-content.tsx` | MODIFY | Add auto-detect button and logic |
| `frontend/app/view/waveconfig/connections-content.scss` | MODIFY | Style detection UI components |

### 7. RPC Integration

Call the new backend command:
```typescript
const result = await RpcApi.DetectAvailableShellsCommand(TabRpcClient, {
    connectionname: "" // Empty for local detection
});

// result.shells contains DetectedShell[]
```

## Dependencies
- Requires TODO-001 (backend detection service) to be completed first
- Needs TypeScript bindings generated via `task generate`

## Acceptance Criteria
- [ ] Auto-detect button visible in connections toolbar
- [ ] Empty state shows prominent auto-detect option
- [ ] Clicking auto-detect calls backend and shows results
- [ ] Results show all detected shells with checkboxes
- [ ] User can select which shells to add
- [ ] Selected shells create proper connection entries
- [ ] Already-configured shells are indicated
- [ ] Loading state shown during detection
- [ ] Error handling for failed detection

## Testing
- Test auto-detect on Windows with various shells installed
- Test auto-detect on macOS
- Test auto-detect on Linux
- Test with no shells detected (edge case)
- Test with some shells already configured
