// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fileutil

import (
	"bytes"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func FixPath(path string) (string, error) {
	origPath := path
	var err error
	if strings.HasPrefix(path, "~") {
		path = filepath.Join(wavebase.GetHomeDir(), path[1:])
	} else if !filepath.IsAbs(path) {
		path, err = filepath.Abs(path)
		if err != nil {
			return "", err
		}
	}
	if strings.HasSuffix(origPath, "/") && !strings.HasSuffix(path, "/") {
		path += "/"
	}
	return path, nil
}

const (
	winFlagSoftlink = uint32(0x8000) // FILE_ATTRIBUTE_REPARSE_POINT
	winFlagJunction = uint32(0x80)   // FILE_ATTRIBUTE_JUNCTION
)

func WinSymlinkDir(path string, bits os.FileMode) bool {
	// Windows compatibility layer doesn't expose symlink target type through fileInfo
	// so we need to check file attributes and extension patterns
	isFileSymlink := func(filepath string) bool {
		if len(filepath) == 0 {
			return false
		}
		return strings.LastIndex(filepath, ".") > strings.LastIndex(filepath, "/")
	}

	flags := uint32(bits >> 12)

	if flags == winFlagSoftlink {
		return !isFileSymlink(path)
	} else if flags == winFlagJunction {
		return true
	} else {
		return false
	}
}

// on error just returns ""
// does not return "application/octet-stream" as this is considered a detection failure
// can pass an existing fileInfo to avoid re-statting the file
// falls back to text/plain for 0 byte files
func DetectMimeType(path string, fileInfo fs.FileInfo, extended bool) string {
	if fileInfo == nil {
		statRtn, err := os.Stat(path)
		if err != nil {
			return ""
		}
		fileInfo = statRtn
	}

	if fileInfo.IsDir() || WinSymlinkDir(path, fileInfo.Mode()) {
		return "directory"
	}
	if fileInfo.Mode()&os.ModeNamedPipe == os.ModeNamedPipe {
		return "pipe"
	}
	charDevice := os.ModeDevice | os.ModeCharDevice
	if fileInfo.Mode()&charDevice == charDevice {
		return "character-special"
	}
	if fileInfo.Mode()&os.ModeDevice == os.ModeDevice {
		return "block-special"
	}
	ext := strings.ToLower(filepath.Ext(path))
	if mimeType, ok := StaticMimeTypeMap[ext]; ok {
		return mimeType
	}
	if mimeType := mime.TypeByExtension(ext); mimeType != "" {
		return mimeType
	}
	if fileInfo.Size() == 0 {
		return "text/plain"
	}
	if !extended {
		return ""
	}
	fd, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer fd.Close()
	buf := make([]byte, 512)
	// ignore the error (EOF / UnexpectedEOF is fine, just process how much we got back)
	n, _ := io.ReadAtLeast(fd, buf, 512)
	if n == 0 {
		return ""
	}
	buf = buf[:n]
	rtn := http.DetectContentType(buf)
	if rtn == "application/octet-stream" {
		return ""
	}
	return rtn
}

func DetectMimeTypeWithDirEnt(path string, dirEnt fs.DirEntry) string {
	if dirEnt != nil {
		if dirEnt.IsDir() {
			return "directory"
		}
		mode := dirEnt.Type()
		if mode&os.ModeNamedPipe == os.ModeNamedPipe {
			return "pipe"
		}
		charDevice := os.ModeDevice | os.ModeCharDevice
		if mode&charDevice == charDevice {
			return "character-special"
		}
		if mode&os.ModeDevice == os.ModeDevice {
			return "block-special"
		}
	}
	ext := strings.ToLower(filepath.Ext(path))
	if mimeType, ok := StaticMimeTypeMap[ext]; ok {
		return mimeType
	}
	return ""
}

func AddMimeTypeToFileInfo(path string, fileInfo *wshrpc.FileInfo) {
	if fileInfo == nil {
		return
	}
	if fileInfo.MimeType == "" {
		fileInfo.MimeType = DetectMimeType(path, ToFsFileInfo(fileInfo), false)
	}
}

var (
	systemBinDirs = []string{
		"/bin/",
		"/usr/bin/",
		"/usr/local/bin/",
		"/opt/bin/",
		"/sbin/",
		"/usr/sbin/",
	}
	suspiciousPattern = regexp.MustCompile(`[:;#!&$\t%="|>{}]`)
	flagPattern       = regexp.MustCompile(` --?[a-zA-Z0-9]`)
)

// IsInitScriptPath tries to determine if the input string is a path to a script
// rather than an inline script content.
func IsInitScriptPath(input string) bool {
	if len(input) == 0 || strings.Contains(input, "\n") {
		return false
	}

	if suspiciousPattern.MatchString(input) {
		return false
	}

	if flagPattern.MatchString(input) {
		return false
	}

	// Check for home directory path
	if strings.HasPrefix(input, "~/") {
		return true
	}

	// Path must be absolute (if not home directory)
	if !filepath.IsAbs(input) {
		return false
	}

	// Check if path starts with system binary directories
	normalizedPath := filepath.ToSlash(input)
	for _, binDir := range systemBinDirs {
		if strings.HasPrefix(normalizedPath, binDir) {
			return false
		}
	}

	return true
}

type FsFileInfo struct {
	NameInternal    string
	ModeInternal    os.FileMode
	SizeInternal    int64
	ModTimeInternal int64
	IsDirInternal   bool
}

func (f FsFileInfo) Name() string {
	return f.NameInternal
}

func (f FsFileInfo) Size() int64 {
	return f.SizeInternal
}

func (f FsFileInfo) Mode() os.FileMode {
	return f.ModeInternal
}

func (f FsFileInfo) ModTime() time.Time {
	return time.Unix(0, f.ModTimeInternal)
}

func (f FsFileInfo) IsDir() bool {
	return f.IsDirInternal
}

func (f FsFileInfo) Sys() interface{} {
	return nil
}

var _ fs.FileInfo = FsFileInfo{}

// ToFsFileInfo converts wshrpc.FileInfo to FsFileInfo.
// It panics if fi is nil.
func ToFsFileInfo(fi *wshrpc.FileInfo) FsFileInfo {
	if fi == nil {
		panic("ToFsFileInfo: nil FileInfo")
	}
	return FsFileInfo{
		NameInternal:    fi.Name,
		ModeInternal:    fi.Mode,
		SizeInternal:    fi.Size,
		ModTimeInternal: fi.ModTime,
		IsDirInternal:   fi.IsDir,
	}
}

const (
	MaxEditFileSize = 5 * 1024 * 1024 // 5MB
)

type EditSpec struct {
	OldStr string `json:"old_str"`
	NewStr string `json:"new_str"`
	Desc   string `json:"desc,omitempty"`
}

type EditResult struct {
	Applied bool   `json:"applied"`
	Desc    string `json:"desc"`
	Error   string `json:"error,omitempty"`
}

// applyEdit applies a single edit to the content and returns the modified content and result.
func applyEdit(content []byte, edit EditSpec, index int) ([]byte, EditResult) {
	result := EditResult{
		Desc: edit.Desc,
	}
	if result.Desc == "" {
		result.Desc = fmt.Sprintf("Edit %d", index+1)
	}

	if edit.OldStr == "" {
		result.Applied = false
		result.Error = "old_str cannot be empty"
		return content, result
	}

	oldBytes := []byte(edit.OldStr)
	count := bytes.Count(content, oldBytes)
	if count == 0 {
		result.Applied = false
		result.Error = "old_str not found in file"
		return content, result
	}
	if count > 1 {
		result.Applied = false
		result.Error = fmt.Sprintf("old_str appears %d times, must appear exactly once", count)
		return content, result
	}

	modifiedContent := bytes.Replace(content, oldBytes, []byte(edit.NewStr), 1)
	result.Applied = true
	return modifiedContent, result
}

// ApplyEdits applies a series of edits to the given content and returns the modified content.
// This is atomic - all edits succeed or all fail.
func ApplyEdits(originalContent []byte, edits []EditSpec) ([]byte, error) {
	modifiedContents := originalContent

	for i, edit := range edits {
		var result EditResult
		modifiedContents, result = applyEdit(modifiedContents, edit, i)
		if !result.Applied {
			return nil, fmt.Errorf("edit %d (%s): %s", i, result.Desc, result.Error)
		}
	}

	return modifiedContents, nil
}

// ApplyEditsPartial applies edits incrementally, continuing until the first failure.
// Returns the modified content (potentially partially applied) and results for each edit.
func ApplyEditsPartial(originalContent []byte, edits []EditSpec) ([]byte, []EditResult) {
	modifiedContents := originalContent
	results := make([]EditResult, len(edits))
	failed := false

	for i, edit := range edits {
		if failed {
			results[i].Desc = edit.Desc
			if results[i].Desc == "" {
				results[i].Desc = fmt.Sprintf("Edit %d", i+1)
			}
			results[i].Applied = false
			results[i].Error = "previous edit failed"
			continue
		}

		modifiedContents, results[i] = applyEdit(modifiedContents, edit, i)
		if !results[i].Applied {
			failed = true
		}
	}

	return modifiedContents, results
}

func ReplaceInFile(filePath string, edits []EditSpec) error {
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return fmt.Errorf("failed to stat file: %w", err)
	}

	if !fileInfo.Mode().IsRegular() {
		return fmt.Errorf("not a regular file: %s", filePath)
	}

	if fileInfo.Size() > MaxEditFileSize {
		return fmt.Errorf("file too large for editing: %d bytes (max: %d)", fileInfo.Size(), MaxEditFileSize)
	}

	contents, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}

	modifiedContents, err := ApplyEdits(contents, edits)
	if err != nil {
		return err
	}

	if err := os.WriteFile(filePath, modifiedContents, fileInfo.Mode()); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

// ReplaceInFilePartial applies edits incrementally up to the first failure.
// Returns the results for each edit and writes the partially modified content.
func ReplaceInFilePartial(filePath string, edits []EditSpec) ([]EditResult, error) {
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

	if !fileInfo.Mode().IsRegular() {
		return nil, fmt.Errorf("not a regular file: %s", filePath)
	}

	if fileInfo.Size() > MaxEditFileSize {
		return nil, fmt.Errorf("file too large for editing: %d bytes (max: %d)", fileInfo.Size(), MaxEditFileSize)
	}

	contents, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	modifiedContents, results := ApplyEditsPartial(contents, edits)

	if err := os.WriteFile(filePath, modifiedContents, fileInfo.Mode()); err != nil {
		return nil, fmt.Errorf("failed to write file: %w", err)
	}

	return results, nil
}
