# Spec 013: High Contrast Compatible Mode

## Overview
Implement a mode that automatically adds contrasting backgrounds to OMP segments that use transparent backgrounds, ensuring readability across all terminal backgrounds.

## Problem Statement
Many OMP themes use transparent backgrounds in segments, relying on the terminal's background color for contrast. When users switch between light and dark terminal themes:
- White text on transparent becomes invisible on light backgrounds
- Black text on transparent becomes invisible on dark backgrounds

## User Story
As a user who uses OMP themes with transparent segments, I want Wave to automatically add contrasting backgrounds so my prompt is readable regardless of my terminal theme.

## How OMP Transparency Works

OMP segments can specify:
```json
{
  "type": "git",
  "style": "plain",
  "foreground": "#ffffff",
  "background": "transparent"
}
```

When `background` is `"transparent"` or `""` (empty), the terminal background shows through.

## Proposed Solution

### High Contrast Mode Algorithm

1. **Parse OMP Config**: Read the user's OMP theme file
2. **Identify Transparent Segments**: Find segments with `background: "transparent"` or no background
3. **Calculate Foreground Luminance**: Determine if foreground is light or dark
4. **Inject Contrasting Background**:
   - Light foreground (luminance > 0.5) → Add dark background (#1a1a1a)
   - Dark foreground (luminance < 0.5) → Add light background (#f5f5f5)
5. **Write Modified Config**: Save as new high-contrast variant

### UI Design

#### Option 1: Auto-Detection (Recommended)
```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️ This theme has 3 transparent segments                    │
│                                                             │
│ [x] Enable High Contrast Mode                               │
│     Automatically adds contrasting backgrounds for          │
│     better readability on any terminal theme                │
│                                                             │
│ Preview:                                                    │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Original:  [git:main] (transparent bg)                  │ │
│ │ Enhanced:  [git:main] (auto-contrasted bg)              │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

#### Option 2: Manual Toggle Per Segment
More complex, allows per-segment control. Consider for future enhancement.

### Implementation

#### 1. Backend: Transparent Segment Detection

```go
// pkg/wshutil/omputil.go

type OmpSegment struct {
    Type       string `json:"type"`
    Style      string `json:"style"`
    Foreground string `json:"foreground"`
    Background string `json:"background"`
    Properties map[string]interface{} `json:"properties,omitempty"`
}

type OmpBlock struct {
    Type        string       `json:"type"`
    Alignment   string       `json:"alignment"`
    Segments    []OmpSegment `json:"segments"`
}

type OmpConfig struct {
    FinalSpace       bool            `json:"final_space"`
    ConsoleTitle     bool            `json:"console_title"`
    ConsoleTitleTemplate string      `json:"console_title_template"`
    Blocks           []OmpBlock      `json:"blocks"`
    Palette          map[string]string `json:"palette,omitempty"`
}

// DetectTransparentSegments returns segments with transparent/empty backgrounds
func DetectTransparentSegments(config *OmpConfig) []TransparentSegmentInfo {
    var results []TransparentSegmentInfo

    for blockIdx, block := range config.Blocks {
        for segIdx, segment := range block.Segments {
            if isTransparent(segment.Background) {
                results = append(results, TransparentSegmentInfo{
                    BlockIndex:   blockIdx,
                    SegmentIndex: segIdx,
                    SegmentType:  segment.Type,
                    Foreground:   segment.Foreground,
                })
            }
        }
    }

    return results
}

func isTransparent(bg string) bool {
    bg = strings.TrimSpace(strings.ToLower(bg))
    return bg == "" || bg == "transparent"
}
```

#### 2. Backend: Luminance Calculation

```go
// pkg/wshutil/colorutil.go

func CalculateLuminance(hexColor string) float64 {
    // Remove # prefix
    hex := strings.TrimPrefix(hexColor, "#")

    // Parse RGB
    r, _ := strconv.ParseInt(hex[0:2], 16, 64)
    g, _ := strconv.ParseInt(hex[2:4], 16, 64)
    b, _ := strconv.ParseInt(hex[4:6], 16, 64)

    // sRGB to linear RGB
    rLin := linearize(float64(r) / 255.0)
    gLin := linearize(float64(g) / 255.0)
    bLin := linearize(float64(b) / 255.0)

    // WCAG relative luminance formula
    return 0.2126*rLin + 0.7152*gLin + 0.0722*bLin
}

func linearize(c float64) float64 {
    if c <= 0.03928 {
        return c / 12.92
    }
    return math.Pow((c+0.055)/1.055, 2.4)
}

func IsLightColor(hexColor string) bool {
    return CalculateLuminance(hexColor) > 0.5
}
```

#### 3. Backend: Apply High Contrast

```go
// pkg/wshutil/omputil.go

const (
    HighContrastDarkBg  = "#1a1a1a"
    HighContrastLightBg = "#f5f5f5"
)

func ApplyHighContrastMode(config *OmpConfig) *OmpConfig {
    modified := deepCopyConfig(config)

    for blockIdx := range modified.Blocks {
        for segIdx := range modified.Blocks[blockIdx].Segments {
            segment := &modified.Blocks[blockIdx].Segments[segIdx]

            if isTransparent(segment.Background) && segment.Foreground != "" {
                // Resolve foreground color (might be palette reference)
                fgColor := resolveColor(segment.Foreground, modified.Palette)

                if IsLightColor(fgColor) {
                    // Light foreground needs dark background
                    segment.Background = HighContrastDarkBg
                } else {
                    // Dark foreground needs light background
                    segment.Background = HighContrastLightBg
                }
            }
        }
    }

    return modified
}

func resolveColor(color string, palette map[string]string) string {
    // Check if it's a palette reference (e.g., "p:blue")
    if strings.HasPrefix(color, "p:") {
        paletteName := strings.TrimPrefix(color, "p:")
        if resolved, ok := palette[paletteName]; ok {
            return resolved
        }
    }
    return color
}
```

#### 4. New IPC Commands

```go
// pkg/wshrpc/wshrpctypes.go

type CommandOmpAnalyzeData struct {
    // Empty - uses $POSH_THEME
}

type CommandOmpAnalyzeRtnData struct {
    TransparentSegments []TransparentSegmentInfo `json:"transparentsegments"`
    HasTransparency     bool                      `json:"hastransparency"`
    Error               string                    `json:"error,omitempty"`
}

type TransparentSegmentInfo struct {
    BlockIndex   int    `json:"blockindex"`
    SegmentIndex int    `json:"segmentindex"`
    SegmentType  string `json:"segmenttype"`
    Foreground   string `json:"foreground"`
}

type CommandOmpApplyHighContrastData struct {
    CreateBackup bool `json:"createbackup"`
}

type CommandOmpApplyHighContrastRtnData struct {
    Success      bool   `json:"success"`
    BackupPath   string `json:"backuppath,omitempty"`
    ModifiedPath string `json:"modifiedpath,omitempty"`
    Error        string `json:"error,omitempty"`
}
```

#### 5. Frontend Component

```typescript
// frontend/app/element/settings/omp-high-contrast.tsx

interface OmpHighContrastProps {
    configPath: string;
}

export const OmpHighContrast = memo(({ configPath }: OmpHighContrastProps) => {
    const [analysis, setAnalysis] = useState<OmpAnalyzeRtnData | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [applying, setApplying] = useState(false);

    useEffect(() => {
        // Analyze on mount
        analyzeConfig();
    }, [configPath]);

    const analyzeConfig = async () => {
        const result = await RpcApi.OmpAnalyzeCommand(TabRpcClient, {});
        setAnalysis(result);
    };

    const handleToggle = async (newValue: boolean) => {
        if (newValue && analysis?.hasTransparency) {
            setApplying(true);
            const result = await RpcApi.OmpApplyHighContrastCommand(TabRpcClient, {
                createBackup: true,
            });
            setApplying(false);

            if (result.success) {
                setEnabled(true);
                // Trigger OMP reinit
            }
        } else {
            // Restore from backup
            setEnabled(false);
        }
    };

    if (!analysis?.hasTransparency) {
        return (
            <div className="omp-high-contrast">
                <div className="no-transparency">
                    <i className="fa fa-check-circle" />
                    <span>Your OMP theme has no transparent segments</span>
                </div>
            </div>
        );
    }

    return (
        <div className="omp-high-contrast">
            <div className="warning-banner">
                <i className="fa fa-exclamation-triangle" />
                <span>
                    This theme has {analysis.transparentSegments.length} transparent segment(s)
                    that may be hard to read on some backgrounds
                </span>
            </div>

            <label className="toggle-row">
                <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => handleToggle(e.target.checked)}
                    disabled={applying}
                />
                <span className="toggle-label">
                    Enable High Contrast Mode
                </span>
            </label>

            <p className="description">
                Automatically adds contrasting backgrounds to transparent segments
                for better readability on any terminal theme.
            </p>

            {analysis.transparentSegments.length > 0 && (
                <details className="segment-details">
                    <summary>View affected segments</summary>
                    <ul>
                        {analysis.transparentSegments.map((seg, i) => (
                            <li key={i}>
                                Block {seg.blockIndex + 1}, Segment: {seg.segmentType}
                                (foreground: {seg.foreground})
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </div>
    );
});
```

## Acceptance Criteria
- [ ] Detects transparent segments in OMP config
- [ ] Shows warning when transparent segments exist
- [ ] Toggle enables/disables high contrast mode
- [ ] Creates backup before modifying config
- [ ] Correctly identifies light vs dark foreground colors
- [ ] Applies appropriate contrasting background
- [ ] Handles palette color references (p:colorname)
- [ ] Works with JSON, YAML, TOML OMP configs

## Edge Cases
- OMP config doesn't exist → Show "not found" message
- OMP config is read-only → Disable toggle, show message
- Foreground is also transparent → Use default contrasting color
- Foreground uses palette reference → Resolve from palette first
- Config has no palette section → Handle gracefully
- User manually edited high-contrast config → Don't overwrite

## Security Considerations
- Validate config paths before read/write
- Create atomic backups before any modification
- Don't execute any code from OMP config
- Sanitize error messages (no path disclosure)

## Future Enhancements
- Per-segment control (enable/disable for specific segments)
- Custom contrast colors (let user pick backgrounds)
- Auto-detect when terminal theme changes and suggest toggle
