// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

import (
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// Validation constants
const (
	MaxPathLength      = 4096
	MaxStringLength    = 256
	MaxURLLength       = 2048
	MaxCommandLength   = 65536   // 64KB
	MaxScriptLength    = 1048576 // 1MB
	MaxArrayItems      = 256
	MaxMapEntries      = 1024
	MaxArrayItemLength = 4096
	MaxMapKeyLength    = 256
	MaxMapValueLength  = 4096
)

// ValidationError provides detailed error information
type ValidationError struct {
	Key     string
	Value   interface{}
	Message string
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("invalid metadata %s: %s", e.Key, e.Message)
}

// ValidationFunc is the signature for field validators
type ValidationFunc func(key string, value interface{}) error

// ValidateMetadata validates metadata for a specific object type
func ValidateMetadata(oref ORef, meta MetaMapType) error {
	validators := getValidatorsForOType(oref.OType)

	for key, value := range meta {
		if value == nil {
			// Null means delete - always allowed
			continue
		}

		if validator, ok := validators[key]; ok {
			if err := validator(key, value); err != nil {
				return err
			}
		}
		// Unknown keys pass through without validation (extensibility)
	}

	return nil
}

func getValidatorsForOType(otype string) map[string]ValidationFunc {
	switch otype {
	case OType_Tab:
		return tabValidators
	case OType_Block:
		return blockValidators
	case OType_Workspace:
		return workspaceValidators
	case OType_Window:
		return windowValidators
	default:
		return commonValidators
	}
}

// ValidatePath checks path fields for security and validity
func ValidatePath(key string, value interface{}, mustBeDir bool) error {
	// Allow clearing (nil handled by caller)
	if value == nil {
		return nil
	}

	path, ok := value.(string)
	if !ok {
		return &ValidationError{
			Key:     key,
			Value:   value,
			Message: fmt.Sprintf("must be a string, got %T", value),
		}
	}

	// Allow empty to clear
	if path == "" {
		return nil
	}

	// Length check (DoS protection)
	if len(path) > MaxPathLength {
		return &ValidationError{
			Key:     key,
			Value:   truncateForError(path, 50),
			Message: fmt.Sprintf("path too long (max %d characters)", MaxPathLength),
		}
	}

	// Null byte check (security)
	if strings.Contains(path, "\x00") {
		return &ValidationError{
			Key:     key,
			Value:   "[contains null byte]",
			Message: "path contains null byte",
		}
	}

	// Path traversal check using absolute path comparison
	if err := checkPathTraversal(path); err != nil {
		return &ValidationError{
			Key:     key,
			Value:   path,
			Message: err.Error(),
		}
	}

	// Expand home directory for existence checks
	expandedPath := path
	if strings.HasPrefix(path, "~") {
		expanded, err := wavebase.ExpandHomeDir(path)
		if err != nil {
			// ExpandHomeDir already checks for traversal
			return &ValidationError{
				Key:     key,
				Value:   path,
				Message: err.Error(),
			}
		}
		expandedPath = expanded
	}

	// Check existence and type (soft validation - warn but allow)
	info, err := os.Stat(expandedPath)
	if err != nil {
		if os.IsNotExist(err) {
			// Log warning but allow non-existent paths
			// This enables setting paths before directories are created
			log.Printf("[validation] warning: %s path does not exist: %s", key, expandedPath)
			return nil
		}
		if os.IsPermission(err) {
			// Permission error - also warn but allow
			log.Printf("[validation] warning: %s path not accessible: %s", key, expandedPath)
			return nil
		}
		// Other errors - allow with warning
		log.Printf("[validation] warning: %s path check failed: %s: %v", key, expandedPath, err)
		return nil
	}

	// Directory check (hard validation if file exists)
	if mustBeDir && !info.IsDir() {
		return &ValidationError{
			Key:     key,
			Value:   path,
			Message: "path is not a directory",
		}
	}

	return nil
}

// checkPathTraversal performs absolute path comparison to detect traversal
func checkPathTraversal(path string) error {
	// Clean the path first
	cleanPath := filepath.Clean(path)

	// Convert to absolute path for comparison
	absPath := cleanPath
	if !filepath.IsAbs(cleanPath) {
		// For relative paths starting with ~, expand first
		if strings.HasPrefix(cleanPath, "~") {
			var err error
			absPath, err = wavebase.ExpandHomeDir(cleanPath)
			if err != nil {
				return fmt.Errorf("path expansion failed: %w", err)
			}
		} else {
			// Get absolute path relative to cwd
			cwd, err := os.Getwd()
			if err != nil {
				// If we can't get cwd, fall back to string check
				if strings.Contains(cleanPath, "..") {
					return fmt.Errorf("path traversal sequence detected")
				}
				return nil
			}
			absPath = filepath.Join(cwd, cleanPath)
		}
	}

	// For Windows UNC paths (\\server\share\path)
	if runtime.GOOS == "windows" && strings.HasPrefix(path, "\\\\") {
		// UNC paths should not traverse above the share
		parts := strings.Split(filepath.Clean(path), string(filepath.Separator))
		if len(parts) >= 4 { // \\server\share\...
			sharePath := filepath.Join(parts[0], parts[1], parts[2], parts[3])
			if !strings.HasPrefix(filepath.Clean(path), sharePath) {
				return fmt.Errorf("path traversal detected in UNC path")
			}
		}
	}

	// Final check: compare cleaned path segments
	// If ".." appears after cleaning, it's traversing
	absPathClean := filepath.Clean(absPath)
	segments := strings.Split(absPathClean, string(filepath.Separator))
	for _, seg := range segments {
		if seg == ".." {
			return fmt.Errorf("path traversal sequence detected after normalization")
		}
	}

	return nil
}

// ValidateBool ensures value is a boolean
func ValidateBool(key string, value interface{}) error {
	if value == nil {
		return nil
	}

	if _, ok := value.(bool); !ok {
		return &ValidationError{
			Key:     key,
			Value:   value,
			Message: fmt.Sprintf("must be a boolean, got %T", value),
		}
	}
	return nil
}

// ValidateNullableBool ensures value is nil or boolean
func ValidateNullableBool(key string, value interface{}) error {
	if value == nil {
		return nil // nil is valid for pointer types
	}

	if _, ok := value.(bool); !ok {
		return &ValidationError{
			Key:     key,
			Value:   value,
			Message: fmt.Sprintf("must be a boolean or null, got %T", value),
		}
	}
	return nil
}

// ValidateString ensures value is a string within length limits
func ValidateString(key string, value interface{}, maxLen int) error {
	if value == nil {
		return nil
	}

	s, ok := value.(string)
	if !ok {
		return &ValidationError{
			Key:     key,
			Value:   value,
			Message: fmt.Sprintf("must be a string, got %T", value),
		}
	}

	if maxLen > 0 && len(s) > maxLen {
		return &ValidationError{
			Key:     key,
			Value:   truncateForError(s, 50),
			Message: fmt.Sprintf("exceeds maximum length of %d characters", maxLen),
		}
	}

	if strings.Contains(s, "\x00") {
		return &ValidationError{
			Key:     key,
			Value:   "[contains null byte]",
			Message: "contains null byte",
		}
	}

	return nil
}

// ValidateInt ensures value is an integer within range
func ValidateInt(key string, value interface{}, minVal, maxVal int) error {
	if value == nil {
		return nil
	}

	// JSON numbers come as float64
	f, ok := value.(float64)
	if !ok {
		return &ValidationError{
			Key:     key,
			Value:   value,
			Message: fmt.Sprintf("must be a number, got %T", value),
		}
	}

	i := int(f)
	if i < minVal || i > maxVal {
		return &ValidationError{
			Key:     key,
			Value:   i,
			Message: fmt.Sprintf("must be between %d and %d", minVal, maxVal),
		}
	}

	return nil
}

// ValidateNullableInt ensures value is nil or integer within range
func ValidateNullableInt(key string, value interface{}, minVal, maxVal int) error {
	if value == nil {
		return nil // nil is valid for pointer types
	}

	// JSON numbers come as float64
	f, ok := value.(float64)
	if !ok {
		return &ValidationError{
			Key:     key,
			Value:   value,
			Message: fmt.Sprintf("must be a number or null, got %T", value),
		}
	}

	i := int(f)
	if i < minVal || i > maxVal {
		return &ValidationError{
			Key:     key,
			Value:   i,
			Message: fmt.Sprintf("must be between %d and %d", minVal, maxVal),
		}
	}

	return nil
}

// ValidateFloat ensures value is a float within range
func ValidateFloat(key string, value interface{}, minVal, maxVal float64) error {
	if value == nil {
		return nil
	}

	f, ok := value.(float64)
	if !ok {
		return &ValidationError{
			Key:     key,
			Value:   value,
			Message: fmt.Sprintf("must be a number, got %T", value),
		}
	}

	if f < minVal || f > maxVal {
		return &ValidationError{
			Key:     key,
			Value:   f,
			Message: fmt.Sprintf("must be between %.2f and %.2f", minVal, maxVal),
		}
	}

	return nil
}

// ValidateNullableFloat ensures value is nil or float within range
func ValidateNullableFloat(key string, value interface{}, minVal, maxVal float64) error {
	if value == nil {
		return nil // nil is valid for pointer types
	}

	f, ok := value.(float64)
	if !ok {
		return &ValidationError{
			Key:     key,
			Value:   value,
			Message: fmt.Sprintf("must be a number or null, got %T", value),
		}
	}

	if f < minVal || f > maxVal {
		return &ValidationError{
			Key:     key,
			Value:   f,
			Message: fmt.Sprintf("must be between %.2f and %.2f", minVal, maxVal),
		}
	}

	return nil
}

// ValidateURL ensures value is a valid URL
func ValidateURL(key string, value interface{}, allowedSchemes []string) error {
	if value == nil {
		return nil
	}

	s, ok := value.(string)
	if !ok {
		return &ValidationError{
			Key:     key,
			Value:   value,
			Message: fmt.Sprintf("must be a string, got %T", value),
		}
	}

	if s == "" {
		return nil
	}

	if len(s) > MaxURLLength {
		return &ValidationError{
			Key:     key,
			Value:   truncateForError(s, 50),
			Message: fmt.Sprintf("URL too long (max %d characters)", MaxURLLength),
		}
	}

	parsed, err := url.Parse(s)
	if err != nil {
		return &ValidationError{
			Key:     key,
			Value:   s,
			Message: fmt.Sprintf("invalid URL: %v", err),
		}
	}

	if len(allowedSchemes) > 0 {
		schemeAllowed := false
		for _, scheme := range allowedSchemes {
			if parsed.Scheme == scheme {
				schemeAllowed = true
				break
			}
		}
		if !schemeAllowed {
			return &ValidationError{
				Key:     key,
				Value:   s,
				Message: fmt.Sprintf("URL scheme must be one of: %v", allowedSchemes),
			}
		}
	}

	return nil
}

// ValidateStringArray validates array fields like cmd:args
func ValidateStringArray(key string, value interface{}, maxLen, maxItems int) error {
	if value == nil {
		return nil
	}

	arr, ok := value.([]interface{})
	if !ok {
		return &ValidationError{
			Key:     key,
			Value:   value,
			Message: fmt.Sprintf("must be an array, got %T", value),
		}
	}

	if len(arr) > maxItems {
		return &ValidationError{
			Key:     key,
			Value:   fmt.Sprintf("[%d items]", len(arr)),
			Message: fmt.Sprintf("array exceeds maximum of %d items", maxItems),
		}
	}

	for i, item := range arr {
		s, ok := item.(string)
		if !ok {
			return &ValidationError{
				Key:     key,
				Value:   fmt.Sprintf("item[%d]", i),
				Message: fmt.Sprintf("array item must be string, got %T", item),
			}
		}

		if len(s) > maxLen {
			return &ValidationError{
				Key:     key,
				Value:   fmt.Sprintf("item[%d]", i),
				Message: fmt.Sprintf("array item exceeds maximum length of %d", maxLen),
			}
		}

		if strings.Contains(s, "\x00") {
			return &ValidationError{
				Key:     key,
				Value:   fmt.Sprintf("item[%d]", i),
				Message: "array item contains null byte",
			}
		}
	}

	return nil
}

// ValidateStringMap validates map fields like cmd:env
func ValidateStringMap(key string, value interface{}, maxKeyLen, maxValueLen int) error {
	if value == nil {
		return nil
	}

	m, ok := value.(map[string]interface{})
	if !ok {
		return &ValidationError{
			Key:     key,
			Value:   value,
			Message: fmt.Sprintf("must be an object/map, got %T", value),
		}
	}

	if len(m) > MaxMapEntries {
		return &ValidationError{
			Key:     key,
			Value:   fmt.Sprintf("{%d entries}", len(m)),
			Message: fmt.Sprintf("map exceeds maximum of %d entries", MaxMapEntries),
		}
	}

	for k, v := range m {
		// Validate key
		if len(k) > maxKeyLen {
			return &ValidationError{
				Key:     key,
				Value:   fmt.Sprintf("key: %s", truncateForError(k, 20)),
				Message: fmt.Sprintf("map key exceeds maximum length of %d", maxKeyLen),
			}
		}

		if strings.Contains(k, "\x00") {
			return &ValidationError{
				Key:     key,
				Value:   fmt.Sprintf("key: %s", k),
				Message: "map key contains null byte",
			}
		}

		// Validate value - allow nil for deletion
		if v == nil {
			continue
		}

		vs, ok := v.(string)
		if !ok {
			return &ValidationError{
				Key:     key,
				Value:   fmt.Sprintf("value for key: %s", k),
				Message: fmt.Sprintf("map value must be string, got %T", v),
			}
		}

		if len(vs) > maxValueLen {
			return &ValidationError{
				Key:     key,
				Value:   fmt.Sprintf("value for key: %s", k),
				Message: fmt.Sprintf("map value exceeds maximum length of %d", maxValueLen),
			}
		}

		if strings.Contains(vs, "\x00") {
			return &ValidationError{
				Key:     key,
				Value:   fmt.Sprintf("value for key: %s", k),
				Message: "map value contains null byte",
			}
		}
	}

	return nil
}

// ValidateCommand validates command execution strings
func ValidateCommand(key string, value interface{}) error {
	return ValidateString(key, value, MaxCommandLength)
}

// ValidateScript validates script content
func ValidateScript(key string, value interface{}) error {
	return ValidateString(key, value, MaxScriptLength)
}

// truncateForError truncates a string for display in error messages
func truncateForError(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

// Common validators for all object types
var commonValidators = map[string]ValidationFunc{
	MetaKey_DisplayName: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxStringLength)
	},
	MetaKey_Icon: func(k string, v interface{}) error {
		return ValidateString(k, v, 128)
	},
	MetaKey_IconColor: func(k string, v interface{}) error {
		return ValidateString(k, v, 64)
	},
}

// Tab-specific validators
var tabValidators = map[string]ValidationFunc{
	MetaKey_TabBaseDir: func(k string, v interface{}) error {
		return ValidatePath(k, v, true) // must be directory
	},
	MetaKey_TabBaseDirLock: ValidateBool,
	MetaKey_TabTermStatus: func(k string, v interface{}) error {
		return ValidateString(k, v, 32) // running, stopped, finished
	},
	MetaKey_Bg: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxURLLength)
	},
	MetaKey_BgOpacity: func(k string, v interface{}) error {
		return ValidateFloat(k, v, 0.0, 1.0)
	},
}

// Workspace-specific validators
var workspaceValidators = map[string]ValidationFunc{
	MetaKey_Bg: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxURLLength)
	},
	MetaKey_BgOpacity: func(k string, v interface{}) error {
		return ValidateFloat(k, v, 0.0, 1.0)
	},
}

// Window-specific validators
var windowValidators = map[string]ValidationFunc{
	MetaKey_Bg: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxURLLength)
	},
	MetaKey_BgOpacity: func(k string, v interface{}) error {
		return ValidateFloat(k, v, 0.0, 1.0)
	},
}

// Block-specific validators
var blockValidators = map[string]ValidationFunc{
	// HIGH RISK: Command execution fields
	MetaKey_Cmd:               ValidateCommand,
	MetaKey_CmdInitScript:     ValidateScript,
	MetaKey_CmdInitScriptSh:   ValidateScript,
	MetaKey_CmdInitScriptBash: ValidateScript,
	MetaKey_CmdInitScriptZsh:  ValidateScript,
	MetaKey_CmdInitScriptPwsh: ValidateScript,
	MetaKey_CmdInitScriptFish: ValidateScript,
	MetaKey_CmdArgs: func(k string, v interface{}) error {
		return ValidateStringArray(k, v, MaxArrayItemLength, MaxArrayItems)
	},
	MetaKey_CmdEnv: func(k string, v interface{}) error {
		return ValidateStringMap(k, v, MaxMapKeyLength, MaxMapValueLength)
	},

	// Path fields
	MetaKey_CmdCwd: func(k string, v interface{}) error {
		return ValidatePath(k, v, true) // must be directory
	},
	MetaKey_File: func(k string, v interface{}) error {
		return ValidatePath(k, v, false) // can be file or directory
	},
	MetaKey_TsunamiAppPath: func(k string, v interface{}) error {
		return ValidatePath(k, v, true)
	},
	MetaKey_TsunamiScaffoldPath: func(k string, v interface{}) error {
		return ValidatePath(k, v, true)
	},
	MetaKey_TsunamiSdkReplacePath: func(k string, v interface{}) error {
		return ValidatePath(k, v, true)
	},
	MetaKey_TermLocalShellPath: func(k string, v interface{}) error {
		return ValidatePath(k, v, false) // executable file
	},

	// URL fields
	MetaKey_Url: func(k string, v interface{}) error {
		return ValidateURL(k, v, []string{"http", "https", "file"})
	},
	MetaKey_PinnedUrl: func(k string, v interface{}) error {
		return ValidateURL(k, v, []string{"http", "https", "file"})
	},
	MetaKey_AiBaseURL: func(k string, v interface{}) error {
		return ValidateURL(k, v, []string{"http", "https"})
	},

	// String fields
	MetaKey_View: func(k string, v interface{}) error {
		return ValidateString(k, v, 64)
	},
	MetaKey_Controller: func(k string, v interface{}) error {
		return ValidateString(k, v, 64)
	},
	MetaKey_Connection: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxStringLength)
	},
	MetaKey_FrameTitle: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxStringLength)
	},
	MetaKey_FrameIcon: func(k string, v interface{}) error {
		return ValidateString(k, v, 128)
	},
	MetaKey_FrameText: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxStringLength)
	},
	MetaKey_FrameBorderColor: func(k string, v interface{}) error {
		return ValidateString(k, v, 64)
	},
	MetaKey_FrameActiveBorderColor: func(k string, v interface{}) error {
		return ValidateString(k, v, 64)
	},
	MetaKey_AiPresetKey: func(k string, v interface{}) error {
		return ValidateString(k, v, 128)
	},
	MetaKey_AiApiType: func(k string, v interface{}) error {
		return ValidateString(k, v, 64)
	},
	MetaKey_AiApiToken: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxURLLength) // API tokens can be long
	},
	MetaKey_AiName: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxStringLength)
	},
	MetaKey_AiModel: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxStringLength)
	},
	MetaKey_AiOrgID: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxStringLength)
	},
	MetaKey_AIApiVersion: func(k string, v interface{}) error {
		return ValidateString(k, v, 64)
	},
	MetaKey_TermFontFamily: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxStringLength)
	},
	MetaKey_TermMode: func(k string, v interface{}) error {
		return ValidateString(k, v, 64)
	},
	MetaKey_TermTheme: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxStringLength)
	},
	MetaKey_SysinfoType: func(k string, v interface{}) error {
		return ValidateString(k, v, 64)
	},
	MetaKey_BgBlendMode: func(k string, v interface{}) error {
		return ValidateString(k, v, 64)
	},
	MetaKey_BgBorderColor: func(k string, v interface{}) error {
		return ValidateString(k, v, 64)
	},
	MetaKey_BgActiveBorderColor: func(k string, v interface{}) error {
		return ValidateString(k, v, 64)
	},
	MetaKey_WebPartition: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxStringLength)
	},
	MetaKey_WebUserAgentType: func(k string, v interface{}) error {
		return ValidateString(k, v, 64)
	},
	MetaKey_VDomCorrelationId: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxStringLength)
	},
	MetaKey_VDomRoute: func(k string, v interface{}) error {
		return ValidateString(k, v, MaxURLLength)
	},

	// Numeric fields
	MetaKey_TermFontSize: func(k string, v interface{}) error {
		return ValidateInt(k, v, 6, 72)
	},
	MetaKey_EditorFontSize: func(k string, v interface{}) error {
		return ValidateFloat(k, v, 6.0, 72.0)
	},
	MetaKey_WebZoom: func(k string, v interface{}) error {
		return ValidateFloat(k, v, 0.25, 5.0)
	},
	MetaKey_GraphNumPoints: func(k string, v interface{}) error {
		return ValidateInt(k, v, 10, 10000)
	},
	MetaKey_BgOpacity: func(k string, v interface{}) error {
		return ValidateFloat(k, v, 0.0, 1.0)
	},
	MetaKey_TermTransparency: func(k string, v interface{}) error {
		return ValidateFloat(k, v, 0.0, 1.0)
	},
	MetaKey_TermScrollback: func(k string, v interface{}) error {
		return ValidateInt(k, v, 100, 100000)
	},
	MetaKey_AiMaxTokens: func(k string, v interface{}) error {
		return ValidateInt(k, v, 1, 1000000)
	},
	MetaKey_AiTimeoutMs: func(k string, v interface{}) error {
		return ValidateInt(k, v, 1000, 600000)
	},
	MetaKey_MarkdownFontSize: func(k string, v interface{}) error {
		return ValidateFloat(k, v, 6.0, 72.0)
	},
	MetaKey_MarkdownFixedFontSize: func(k string, v interface{}) error {
		return ValidateFloat(k, v, 6.0, 72.0)
	},
	MetaKey_WaveAiPanelWidth: func(k string, v interface{}) error {
		return ValidateFloat(k, v, 100, 2000)
	},
	MetaKey_DisplayOrder: func(k string, v interface{}) error {
		return ValidateFloat(k, v, -1000000, 1000000)
	},

	// Nullable pointer fields
	MetaKey_CmdCloseOnExitDelay: func(k string, v interface{}) error {
		return ValidateNullableInt(k, v, 0, 60000)
	},

	// Boolean fields
	MetaKey_Edit:                    ValidateBool,
	MetaKey_Frame:                   ValidateBool,
	MetaKey_CmdInteractive:          ValidateBool,
	MetaKey_CmdLogin:                ValidateBool,
	MetaKey_CmdRunOnStart:           ValidateBool,
	MetaKey_CmdClearOnStart:         ValidateBool,
	MetaKey_CmdRunOnce:              ValidateBool,
	MetaKey_CmdCloseOnExit:          ValidateBool,
	MetaKey_CmdCloseOnExitForce:     ValidateBool,
	MetaKey_CmdNoWsh:                ValidateBool,
	MetaKey_CmdShell:                ValidateBool,
	MetaKey_CmdAllowConnChange:      ValidateBool,
	MetaKey_EditorMinimapEnabled:    ValidateBool,
	MetaKey_EditorStickyScrollEnabled: ValidateBool,
	MetaKey_EditorWordWrap:          ValidateBool,
	MetaKey_WebHideNav:              ValidateBool,
	MetaKey_VDomInitialized:         ValidateBool,
	MetaKey_VDomPersist:             ValidateBool,
	MetaKey_TermAllowBracketedPaste: ValidateBool,
	MetaKey_TermShiftEnterNewline:   ValidateBool,
	MetaKey_TermMacOptionIsMeta:     ValidateBool,
	MetaKey_TermConnDebug:           ValidateBool,
	MetaKey_WaveAiPanelOpen:         ValidateBool,
}

// PresetKeyScope defines which keys are allowed for each preset type
var PresetKeyScope = map[string]map[string]bool{
	"tabvar@": {
		MetaKey_TabBaseDir:     true,
		MetaKey_TabBaseDirLock: true,
		MetaKey_DisplayName:    true,
		MetaKey_DisplayOrder:   true,
	},
	"bg@": {
		MetaKey_BgClear:             true,
		MetaKey_Bg:                  true,
		MetaKey_BgOpacity:           true,
		MetaKey_BgBlendMode:         true,
		MetaKey_BgBorderColor:       true,
		MetaKey_BgActiveBorderColor: true,
		MetaKey_BgText:              true,
		MetaKey_DisplayName:         true,
		MetaKey_DisplayOrder:        true,
	},
}

// ValidatePresetScope checks if preset keys are within allowed scope
// This is called during config load, not during UpdateObjectMeta
func ValidatePresetScope(presetName string, meta MetaMapType) error {
	// Determine preset type from name prefix
	var allowedKeys map[string]bool
	for prefix, keys := range PresetKeyScope {
		if strings.HasPrefix(presetName, prefix) {
			allowedKeys = keys
			break
		}
	}

	if allowedKeys == nil {
		// Unknown preset type - log warning but allow
		log.Printf("[validation] warning: unknown preset type for %s", presetName)
		return nil
	}

	for key := range meta {
		if !allowedKeys[key] {
			return &ValidationError{
				Key:     key,
				Value:   meta[key],
				Message: fmt.Sprintf("key not allowed in %s presets", presetName),
			}
		}
	}

	return nil
}

// init merges common validators into specific validators
func init() {
	for k, v := range commonValidators {
		if _, exists := tabValidators[k]; !exists {
			tabValidators[k] = v
		}
		if _, exists := blockValidators[k]; !exists {
			blockValidators[k] = v
		}
		if _, exists := workspaceValidators[k]; !exists {
			workspaceValidators[k] = v
		}
		if _, exists := windowValidators[k]; !exists {
			windowValidators[k] = v
		}
	}
}
