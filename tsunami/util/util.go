package util

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"time"
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

func ChunkSlice[T any](slice []T, chunkSize int) [][]T {
	if len(slice) == 0 {
		return nil
	}
	chunks := make([][]T, 0)
	for i := 0; i < len(slice); i += chunkSize {
		end := i + chunkSize
		if end > len(slice) {
			end = len(slice)
		}
		chunks = append(chunks, slice[i:end])
	}
	return chunks
}

func OpenBrowser(url string, delay time.Duration) {
	if delay > 0 {
		time.Sleep(delay)
	}
	
	var cmd string
	var args []string

	switch runtime.GOOS {
	case "windows":
		cmd = "cmd"
		args = []string{"/c", "start", url}
	case "darwin":
		cmd = "open"
		args = []string{url}
	default: // "linux", "freebsd", "openbsd", "netbsd"
		cmd = "xdg-open"
		args = []string{url}
	}

	exec.Command(cmd, args...).Start()
}

func GetTypedAtomValue[T any](rawVal any, atomName string) T {
	var result T
	if rawVal == nil {
		return *new(T)
	}

	var ok bool
	result, ok = rawVal.(T)
	if !ok {
		// Try converting from float64 if rawVal is float64
		if f64Val, isFloat64 := rawVal.(float64); isFloat64 {
			if converted, convOk := FromFloat64[T](f64Val); convOk {
				return converted
			}
		}
		panic(fmt.Sprintf("GetTypedAtomValue %q value type mismatch (expected %T, got %T)", atomName, *new(T), rawVal))
	}
	return result
}
