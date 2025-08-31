package util

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
)

func PanicHandler(debugStr string, recoverVal any) error {
	if recoverVal == nil {
		return nil
	}
	log.Printf("[panic] in %s: %v\n", debugStr, recoverVal)
	debug.PrintStack()
	if err, ok := recoverVal.(error); ok {
		return fmt.Errorf("panic in %s: %w", debugStr, err)
	}
	return fmt.Errorf("panic in %s: %v", debugStr, recoverVal)
}

func GetHomeDir() string {
	homeVar, err := os.UserHomeDir()
	if err != nil {
		return "/"
	}
	return homeVar
}

func ExpandHomeDir(pathStr string) (string, error) {
	if pathStr != "~" && !strings.HasPrefix(pathStr, "~/") && (!strings.HasPrefix(pathStr, `~\`) || runtime.GOOS != "windows") {
		return filepath.Clean(pathStr), nil
	}
	homeDir := GetHomeDir()
	if pathStr == "~" {
		return homeDir, nil
	}
	expandedPath := filepath.Clean(filepath.Join(homeDir, pathStr[2:]))
	absPath, err := filepath.Abs(filepath.Join(homeDir, expandedPath))
	if err != nil || !strings.HasPrefix(absPath, homeDir) {
		return "", fmt.Errorf("potential path traversal detected for path %s", pathStr)
	}
	return expandedPath, nil
}

func ExpandHomeDirSafe(pathStr string) string {
	path, _ := ExpandHomeDir(pathStr)
	return path
}
