# Spec: Connections Auto-Detection UI (TODO-002)

## Objective

Add auto-detection button and UI to the Connections settings page that allows users to discover and add available shells with minimal effort.

## Context

This feature is designed for the Connections settings page (`frontend/app/view/waveconfig/connections-content.tsx`) and depends on the backend detection service (TODO-001).

## User Experience Flow

### Entry Points
- **Toolbar button**: User clicks auto-detect button (wand icon) next to "Add" button
- **Empty state**: When no connections exist, prominent "Auto-Detect Shells" button is displayed

### Detection Flow
1. Click triggers RPC call to `DetectAvailableShellsCommand`
2. Loading spinner shown with message "Detecting available shells..."
3. Results panel appears showing detected shells
4. `aria-live="polite"` region announces "Found N shells" on completion

### Selection Flow
- User sees list of detected shells with checkboxes
- Already-configured shells shown but disabled with "Already configured" badge
- "Add Selected (N)" button shows count

## UI Mockups

### Connections List with Auto-Detect Button

```
+----------------------------------------------------------+
| Connections                             [wand] [+Add]    |
+----------------------------------------------------------+
| [server] user@server1.com                           [>] |
| [linux]  wsl://Ubuntu                               [>] |
+----------------------------------------------------------+
```

### Empty State with Auto-Detect

```
+----------------------------------------------------------+
|                      [plug icon]                         |
|                   No Connections                         |
|                                                          |
|    Wave can automatically detect available shells        |
|    on your system including PowerShell, WSL, and more.   |
|                                                          |
|               [wand] Auto-Detect Shells                  |
|                                                          |
|              Or manually add a connection:               |
|                    [+ Add Connection]                    |
+----------------------------------------------------------+
```

### Detection Results Panel

```
+----------------------------------------------------------+
| [<- Back]  Detected Shells (5)                    [X]    |
+----------------------------------------------------------+
| [v] [pwsh]  PowerShell 7.4.0                            |
|             C:\Program Files\PowerShell\7\pwsh.exe       |
|                                                          |
| [v] [ps]    Windows PowerShell 5.1                      |
|             System default                               |
|                                                          |
| [v] [linux] Ubuntu (WSL)                                |
|             wsl.exe -d Ubuntu                            |
|                                                          |
| [ ] [cmd]   Command Prompt              [Already added]  |
|             C:\Windows\System32\cmd.exe                  |
+----------------------------------------------------------+
| [Select All] [Select None]        [Add Selected (4)]     |
+----------------------------------------------------------+
```

## Component Design

### New State Variables

```typescript
const [isDetecting, setIsDetecting] = useState(false);
const [showDetectionPanel, setShowDetectionPanel] = useState(false);
const [detectedShells, setDetectedShells] = useState<DetectedShell[]>([]);
const [selectedShells, setSelectedShells] = useState<Set<string>>(new Set());
const [detectionError, setDetectionError] = useState<string | null>(null);
```

### Key Functions

- `handleAutoDetect()` - Triggers RPC call, shows panel
- `isShellAlreadyConfigured(shell)` - Checks for duplicates
- `handleAddSelectedShells()` - Creates connections from selected shells

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `frontend/app/view/waveconfig/connections-content.tsx` | MODIFY | Add auto-detect button, detection panel, handlers |
| `frontend/app/view/waveconfig/connections-content.scss` | MODIFY | Add styles for detection UI components |

## Error Handling

| Error Code | User Message |
|------------|--------------|
| `REGISTRY_ACCESS` | "Could not access system registry. Some shells may not be detected." |
| `TIMEOUT` | "Detection timed out. Please try again." |
| `WSL_ERROR` | "Could not query WSL. Ensure WSL is installed and running." |

## Accessibility

- Use `role="dialog"` for detection panel
- Checkbox `aria-label` describes each shell
- Status badges have proper aria-labels
- Keyboard navigation with Tab, Space/Enter, Escape
- Focus order: Back button → checkboxes (top to bottom) → Select All → Select None → Add Selected → Close
- Focus trapped within panel when open
- `aria-live="polite"` region announces detection completion

## Icons

Use `fa-wand-magic-sparkles` for the auto-detect button (Font Awesome sharp solid icon).

## Acceptance Criteria

- [ ] Auto-detect button visible in connections toolbar (wand icon)
- [ ] Empty state shows prominent auto-detect option
- [ ] Clicking auto-detect shows loading spinner with message
- [ ] Detection results displayed in a panel
- [ ] Each detected shell shows: name, version, path, icon
- [ ] Checkboxes allow selecting which shells to add
- [ ] Already-configured shells shown with disabled checkbox and badge
- [ ] "Select All" and "Select None" buttons work
- [ ] "Add Selected (N)" button shows count and is disabled when N=0
- [ ] Clicking "Add Selected" creates connection entries
- [ ] Error state shows message and retry button
- [ ] All interactive elements have keyboard support

## Dependencies

- Requires TODO-001 (backend detection service) to be complete
- TypeScript bindings generated via `task generate`
